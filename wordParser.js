const mammoth = require('mammoth');
const fs = require('fs');

/**
 * Parse a Word document (.docx) containing questions in table or text format
 */
async function parseWordDocument(fileBuffer, metadata = {}) {
    try {
        const result = await mammoth.convertToHtml({ buffer: fileBuffer });
        const html = result.value;
        const tables = extractTablesFromHtml(html);

        let questions = [];

        if (tables.length > 0) {
            questions = convertTableToQuestions(tables[0], metadata);
            if (questions.length === 0) {
                // Try both HTML and raw text parsing
                const htmlQuestions = parseHtmlFormatQuestions(html, metadata);
                if (htmlQuestions.length === 0) {
                    // Last resort: try raw text extraction
                    const textResult = await mammoth.extractRawText({ buffer: fileBuffer });
                    const textQuestions = parseTextFormatQuestions(textResult.value, metadata);
                    questions = textQuestions;
                } else {
                    questions = htmlQuestions;
                }
            }
        } else {
            // Try HTML parsing first
            const htmlQuestions = parseHtmlFormatQuestions(html, metadata);
            if (htmlQuestions.length === 0) {
                // Fallback to raw text
                const textResult = await mammoth.extractRawText({ buffer: fileBuffer });
                const textQuestions = parseTextFormatQuestions(textResult.value, metadata);
                questions = textQuestions;
            } else {
                questions = htmlQuestions;
            }
        }

        return {
            success: true,
            count: questions.length,
            questions: questions,
            warnings: result.warnings || []
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            count: 0,
            questions: []
        };
    }
}

function extractTablesFromHtml(html) {
    const tables = [];
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;
    while ((tableMatch = tableRegex.exec(html)) !== null) {
        const tableContent = tableMatch[1];
        const rows = [];
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let rowMatch;
        while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
            const rowContent = rowMatch[1];
            const cells = [];
            const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
            let cellMatch;
            while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
                cells.push(cleanHtmlText(cellMatch[1]).trim());
            }
            if (cells.length > 0 && cells.some(c => c.length > 0)) rows.push(cells);
        }
        if (rows.length > 0) tables.push(rows);
    }
    return tables;
}

function cleanHtmlText(html) {
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/&nbsp;/g, ' ')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&amp;/g, '&');
    return text.replace(/\s+/g, ' ').trim();
}

function convertTableToQuestions(table, metadata = {}) {
    const questions = [];
    let startIndex = 0;
    if (table.length > 0) {
        const firstRow = table[0];
        const headerKeywords = ['question', 'soal', 'pertanyaan', 'option', 'pilihan', 'answer', 'kunci'];
        if (firstRow.some(cell => headerKeywords.some(keyword => cell.toLowerCase().includes(keyword)))) {
            startIndex = 1;
        }
    }
    for (let i = startIndex; i < table.length; i++) {
        const row = table[i];
        if (row.length < 3) continue;
        const questionText = row[0];
        const correctAnswersRaw = row[row.length - 1];
        let options = row.slice(1, -1).map(opt => opt.trim()).filter(Boolean);
        
        const questionObj = parseQuestionRow(questionText, options, correctAnswersRaw, metadata);
        if (questionObj) questions.push(questionObj);
    }
    return questions;
}

function parseQuestionRow(question, options, correctAnswersRaw, metadata) {
    if (!question || options.length < 1 || !correctAnswersRaw) return null;
    const correctIndices = parseCorrectAnswers(correctAnswersRaw, options);
    if (correctIndices === null) {
        return {
            text: question.trim(), type: 'text', correct: correctAnswersRaw.trim(),
            mapel: metadata.subject || 'General', rombel: metadata.class || ''
        };
    }
    if (Array.isArray(correctIndices)) {
        return {
            text: question.trim(),
            type: correctIndices.length === 1 ? 'single' : 'multiple',
            options,
            correct: correctIndices.length === 1 ? correctIndices[0] : correctIndices,
            mapel: metadata.subject || 'General', rombel: metadata.class || ''
        };
    }
    return null;
}

function parseCorrectAnswers(raw, options) {
    const raw_trimmed = raw.trim();
    if (!raw_trimmed) return null;
    const indices = new Set();
    let parts = raw_trimmed.split(/[\s,;\/]+/).map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
        if (/^[A-Z]$/i.test(part)) {
            const idx = part.toUpperCase().charCodeAt(0) - 65;
            if (idx >= 0 && idx < options.length) indices.add(idx);
        } else if (/^\d+$/.test(part)) {
            const idx = parseInt(part, 10) - 1;
            if (idx >= 0 && idx < options.length) indices.add(idx);
        } else {
            const idx = options.findIndex(opt => opt.toLowerCase() === part.toLowerCase());
            if (idx !== -1) indices.add(idx);
        }
    }
    return indices.size > 0 ? Array.from(indices).sort((a, b) => a - b) : null;
}

function parseHtmlFormatQuestions(html, metadata = {}) {
    // Extract text content from HTML while preserving some structure
    // First, try to extract from paragraph tags
    const paragraphs = [];
    const paraRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let paraMatch;
    while ((paraMatch = paraRegex.exec(html)) !== null) {
        const paraContent = cleanHtmlText(paraMatch[1]);
        if (paraContent.trim()) {
            paragraphs.push(paraContent.trim());
        }
    }

    // If no paragraphs found, try other block elements
    if (paragraphs.length === 0) {
        const blockRegex = /<(?:div|h[1-6]|li|td)[^>]*>([\s\S]*?)<\/(?:div|h[1-6]|li|td)>/gi;
        let blockMatch;
        while ((blockMatch = blockRegex.exec(html)) !== null) {
            const blockContent = cleanHtmlText(blockMatch[1]);
            if (blockContent.trim()) {
                paragraphs.push(blockContent.trim());
            }
        }
    }

    // If still no content, fall back to general text extraction
    let lines = [];
    if (paragraphs.length > 0) {
        lines = paragraphs;
    } else {
        const textContent = html.replace(/<[^>]+>/g, ' ')
                               .replace(/&nbsp;/g, ' ')
                               .replace(/\s+/g, ' ')
                               .trim();
        lines = textContent.split(/\n/).map(line => line.trim()).filter(Boolean);
    }

    return parseTextFormatQuestions(lines.join('\n'), metadata);
}

function parseTextFormatQuestions(rawText, metadata = {}) {
    const questions = [];
    const lines = rawText.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
    let i = 0;

    // Collect reading passage if present (lines before first numbered question)
    let readingPassage = [];
    while (i < lines.length) {
        const line = lines[i];
        // Check if this line starts a question (numbered or not)
        if (line.match(/^\d+\./) ||
            line.match(/^[A-F][\.\)\:\-\s]/i) ||
            line.match(/\b(?:kunci|jawaban|answer|key|correct|benar)\b/i) ||
            line.match(/^\d+\s*\./)) { // Also check for "1 ." format
            break;
        }
        // If it's a substantial line (not just whitespace), add to reading passage
        if (line.length > 5) { // Reduced minimum length for reading text
            readingPassage.push(line);
        }
        i++;
    }

    // Join reading passage if found
    const readingText = readingPassage.length > 0 ? readingPassage.join(' ') : null;

    // Reset i to start parsing questions
    i = readingPassage.length;

    while (i < lines.length) {
        const questionData = parseSingleTextQuestion(lines, i, metadata, readingText);
        if (questionData.question) {
            questions.push(questionData.question);
            i = questionData.nextIndex;
        } else {
            i++;
        }
    }
}

function parseSingleTextQuestion(lines, startIndex, metadata, readingText = null) {
    let i = startIndex;
    let questionText = lines[i++];
    const numMatch = questionText.match(/^\d+\.\s*(.+)$/);
    if (numMatch) questionText = numMatch[1].trim();

    // Prepend reading passage if available
    if (readingText && readingText.trim()) {
        questionText = readingText.trim() + '\n\n' + questionText;
    }

    const options = [];
    const optionMap = {};
    let correctAnswer = null;
    
    // Parse options and answer in one pass
    while (i < lines.length) {
        const line = lines[i];
        
        // Check for answer key first (more flexible patterns)
        const answerMatch = line.match(/\b(?:kunci|jawaban|answer|key|correct|benar)\b[\s:\-\.]*([^\r\n]+)$/i) ||
                           line.match(/^[\*\-\s]*(?:kunci|jawaban|answer|key|correct|benar)[\s:\-\.]*([^\r\n]+)$/i) ||
                           line.match(/^([A-F])\s*$/i); // Single letter on its own line
        if (answerMatch) {
            correctAnswer = answerMatch[1] ? answerMatch[1].trim() : line.trim();
            i++;
            break; // Stop parsing options after finding answer
        }
        
        // Try to parse as option
        const option = parseOptionLine(line);
        if (option) {
            if (option.label) {
                // If labeled (A, B, C, D), store by label
                optionMap[option.label] = option.text;
            } else {
                // If unlabeled, add to options array
                options.push(option.text);
            }
            i++;
        } else {
            // If not an option and not an answer, might be part of question or next question
            break;
        }
    }

    // Convert labeled options to ordered array
    const orderedOptions = [];
    for (let letter = 'A'; letter <= 'F'; letter++) {
        if (optionMap[letter]) {
            orderedOptions.push(optionMap[letter]);
        }
    }
    // Add any unlabeled options at the end
    orderedOptions.push(...options);

    // Use ordered options, but limit to reasonable number
    const finalOptions = orderedOptions.slice(0, 6);

    if (correctAnswer && finalOptions.length > 0) {
        const indices = finalOptions.length >= 2 ? parseCorrectAnswers(correctAnswer, finalOptions) : null;
        const qObj = {
            text: questionText,
            mapel: metadata.subject || 'General',
            rombel: metadata.class || ''
        };
        if (indices) {
            qObj.type = indices.length === 1 ? 'single' : 'multiple';
            qObj.options = finalOptions;
            qObj.correct = indices.length === 1 ? indices[0] : indices;
        } else {
            qObj.type = 'text';
            qObj.correct = correctAnswer;
        }
        return { question: qObj, nextIndex: i };
    }
    return { question: null, nextIndex: i };
}

function parseOptionLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // Remove bullet points first
    const bulletMatch = trimmed.match(/^[\u2022\u2023\u25E6\u2043\u2219\-\*\+]\s*(.+)$/);
    const candidate = bulletMatch ? bulletMatch[1].trim() : trimmed;

    // Enhanced ABCD option parsing with more flexible patterns
    const letterMatch = candidate.match(/^([A-F])(?:[\.\)\:\-\s]+)\s*(.+)$/i);
    if (letterMatch && letterMatch[2].trim()) {
        return { label: letterMatch[1].toUpperCase(), text: letterMatch[2].trim() };
    }

    // Support for numbered options that might be used instead of letters
    const numericMatch = candidate.match(/^(\d+)(?:[\.\)\:\-\s]+)\s*(.+)$/);
    if (numericMatch && numericMatch[2].trim()) {
        // Convert number to letter (1->A, 2->B, etc.)
        const num = parseInt(numericMatch[1]);
        if (num >= 1 && num <= 6) {
            const letter = String.fromCharCode(64 + num); // 1->A, 2->B, etc.
            return { label: letter, text: numericMatch[2].trim() };
        }
        return { label: null, text: numericMatch[2].trim() };
    }

    // Accept pure bullet list items without labels as options too, but only if substantial
    if (bulletMatch && candidate.length > 3) {
        return { label: null, text: candidate };
    }

    return null;
}

module.exports = { parseWordDocument };
