const mammoth = require('mammoth');
const fs = require('fs');

/**
 * Parse a Word document (.docx) containing questions in table or text format
 */
async function parseWordDocument(fileBuffer, metadata = {}) {
    try {
        const result = await mammoth.convertToHtml({ buffer: fileBuffer });
        let html = result.value;
        html = prepareListHtml(html);
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

        // Validate that we found at least some questions
        if (questions.length === 0) {
            console.log('⚠️ No questions found in document');
            return {
                success: false,
                error: 'Tidak ada soal yang ditemukan dalam dokumen. Pastikan dokumen menggunakan format yang didukung.',
                count: 0,
                questions: []
            };
        }

        return {
            success: true,
            count: questions.length,
            questions: questions,
            warnings: result.warnings || []
        };
    } catch (error) {
        console.error('❌ Word parsing error:', error.message);
        console.error('❌ Error stack:', error.stack);
        return {
            success: false,
            error: `Gagal memproses file Word: ${error.message}`,
            count: 0,
            questions: []
        };
    }
}

function prepareListHtml(html) {
    let listStack = [];
    let counters = [];
    
    // Inject numbering formats into lists
    let newHtml = html.replace(/<\/?(?:ol|ul|li)[^>]*>/gi, function(match) {
        const tag = match.toLowerCase();
        if (tag.startsWith('<ol')) {
            listStack.push('ol');
            counters.push(0);
            return match;
        } else if (tag.startsWith('<ul')) {
            listStack.push('ul');
            counters.push(0);
            return match;
        } else if (tag.startsWith('</ol') || tag.startsWith('</ul')) {
            listStack.pop();
            counters.pop();
            return match;
        } else if (tag.startsWith('<li')) {
            let result = match;
            if (listStack.length > 0) {
                let type = listStack[listStack.length - 1];
                let level = listStack.length;
                
                if (type === 'ol') {
                    let idx = counters[counters.length - 1]++;
                    if (level === 1) {
                        result += `${idx + 1}. `;
                    } else {
                        let letter = String.fromCharCode(65 + (idx % 26));
                        result += `${letter}. `;
                    }
                } else if (type === 'ul') {
                    result += `• `;
                }
            }
            return result;
        }
        return match;
    });

    // Move injected markers INSIDE the first <p> tag of the <li> if it exists
    newHtml = newHtml.replace(/(<li[^>]*>)(\d+\.\s|[A-Z]\.\s|•\s)\s*(<p[^>]*>)/gi, '$1$3$2');
    
    return newHtml;
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
    let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
                  .replace(/<\/(p|div|li|h[1-6]|td|tr|table|ul|ol)>/gi, '\n')
                  .replace(/<br[^>]*>/gi, '\n')
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/&nbsp;/g, ' ')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&amp;/g, '&');
    return text.replace(/[ \t]+/g, ' ').trim();
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
    if (!question || !correctAnswersRaw) return null;
    
    let finalOptions = [...options];
    let finalQuestion = question.trim();

    // If no explicit options columns were found, they might be merged in the question cell.
    if (finalOptions.length === 0) {
        const lines = finalQuestion.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 2) {
            const possibleOptions = [];
            let splitIndex = lines.length;
            for (let j = 1; j <= Math.min(6, lines.length - 1); j++) {
                const line = lines[lines.length - j];
                // Check if it looks like an option (A. B. C.)
                const isExplicitOpt = /^([A-F]|\d+)(?:[\.\)\:\-\s]+)\s*(.+)$/i.test(line);
                if (isExplicitOpt || line.length < 150) {
                    splitIndex = lines.length - j;
                } else {
                    break;
                }
            }
            if (lines.length - splitIndex >= 2) {
                finalOptions = lines.splice(splitIndex);
                finalQuestion = lines.join('\n');
            }
        }
    }

    if (finalOptions.length === 0) {
        return {
            text: finalQuestion, type: 'text', correct: correctAnswersRaw.trim(),
            mapel: metadata.subject || 'General', rombel: metadata.class || ''
        };
    }

    const correctIndices = parseCorrectAnswers(correctAnswersRaw, finalOptions);
    if (correctIndices === null) {
        return {
            text: finalQuestion, type: 'text', correct: correctAnswersRaw.trim(),
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
    // First remove scripts/styles just in case
    let clean = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
    
    // Replace closing tags of block elements and <br> with newlines
    clean = clean.replace(/<\/(p|div|li|h[1-6]|td|tr|table|ul|ol)>/gi, '\n')
                 .replace(/<br[^>]*>/gi, '\n');
             
    // Clean all remaining HTML tags
    clean = clean.replace(/<[^>]+>/g, ' ')
                 .replace(/&nbsp;/g, ' ')
                 .replace(/&lt;/g, '<')
                 .replace(/&gt;/g, '>')
                 .replace(/&amp;/g, '&');
                 
    // Replace multiple spaces with single space, but preserve newlines
    clean = clean.replace(/[ \t]+/g, ' ').trim();
    
    // Extract lines
    const lines = clean.split('\n').map(line => line.trim()).filter(Boolean);
    
    return parseTextFormatQuestions(lines.join('\n'), metadata);
}

function isOptionLine(line) {
    if (!line || !line.trim()) return false;
    return parseOptionLine(line) !== null;
}

function isAnswerLine(line) {
    if (!line || !line.trim()) return false;
    return /\b(?:kunci|jawaban|answer|key|correct|benar)\b[\s:\-\.]*([^\r\n]+)$/i.test(line)
        || /^[\*\-\s]*(?:kunci|jawaban|answer|key|correct|benar)[\s:\-\.]*([^\r\n]+)$/i.test(line)
        || /^([A-F])\s*$/i.test(line);
}

function looksLikeQuestionStart(lines, index) {
    if (index >= lines.length) return false;
    const line = lines[index].trim();
    if (!line) return false;
    if (/^\d+\./.test(line)) return true;
    if (/^[A-F][\.\)\:\-\s]/i.test(line)) return false;

    let optionCount = 0;
    let j = index + 1;
    let foundAnswer = false;
    while (j < lines.length && optionCount < 6) {
        const nextLine = lines[j];
        if (isOptionLine(nextLine)) {
            optionCount++;
            j++;
            continue;
        }
        if (isAnswerLine(nextLine)) {
            foundAnswer = true;
            break;
        }
        // If we hit a new question start, break
        if (/^\d+\./.test(nextLine)) {
            break;
        }
        // Break on anything else that is not an empty option
        break;
    }
    // We relax the strict requirement of an answer line to support documents without explicit inline keys
    return optionCount >= 2;
}

function parseTextFormatQuestions(rawText, metadata = {}) {
    const questions = [];
    const lines = rawText.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
    let i = 0;

    let readingPassage = [];
    while (i < lines.length) {
        if (looksLikeQuestionStart(lines, i)) {
            break;
        }
        const line = lines[i];
        if (line.length > 5) {
            readingPassage.push(line);
        }
        i++;
    }

    const readingText = readingPassage.length > 0 ? readingPassage.join(' ') : null;
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
    return questions;
}

function parseSingleTextQuestion(lines, startIndex, metadata, readingText = null) {
    let i = startIndex;
    const questionLines = [];
    
    // Always include the first line as part of the question to prevent `1. Soal` from being swallowed as an option
    if (i < lines.length) {
        questionLines.push(lines[i]);
        i++;
    }

    while (i < lines.length && !isOptionLine(lines[i]) && !isAnswerLine(lines[i])) {
        // If the next line looks exactly like another question start, we shouldn't swallow it.
        // But to be safe, we just let it be swallowed if it's text, unless it's a number.
        // Actually, if it's a new question, it should have been caught in the outer loop.
        questionLines.push(lines[i]);
        i++;
    }

    if (questionLines.length === 0) {
        return { question: null, nextIndex: i };
    }

    let questionText = questionLines.join(' ');
    const numMatch = questionText.match(/^\d+\.\s*(.+)$/);
    if (numMatch) questionText = numMatch[1].trim();

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

    // Convert labeled options to ordered array (Check A-F and 1-6)
    const orderedOptions = [];
    // First, try to find options labeled A-F
    for (let letter = 'A'; letter <= 'F'; letter = String.fromCharCode(letter.charCodeAt(0) + 1)) {
        if (optionMap[letter]) {
            orderedOptions.push(optionMap[letter]);
        }
    }
    
    // If empty, the options might be numbered (1, 2, 3...) starting from 2 (since 1 was the question)
    if (orderedOptions.length === 0) {
        for (let num = 1; num <= 10; num++) {
            if (optionMap[num.toString()]) {
                orderedOptions.push(optionMap[num.toString()]);
            }
        }
    }

    // Add any unlabeled options at the end
    orderedOptions.push(...options);

    // Use ordered options, but limit to reasonable number
    const finalOptions = orderedOptions.slice(0, 6);

    // Heuristic: If we found no explicit options, the user might not have labeled them at all
    // and they were sucked into the question text. The last 2-5 short lines are likely options.
    if (finalOptions.length === 0 && questionLines.length > 2) {
        let splitIndex = questionLines.length;
        for (let j = 1; j <= Math.min(6, questionLines.length - 1); j++) {
            const l = questionLines[questionLines.length - j];
            if (l.length < 150) {
                splitIndex = questionLines.length - j;
            } else {
                break;
            }
        }
        if (questionLines.length - splitIndex >= 2) {
            const extracted = questionLines.splice(splitIndex);
            finalOptions.push(...extracted);
            
            // Reconstruct the question string from remaining lines
            questionText = questionLines.join('\n');
            if (readingText && readingText.trim()) {
                questionText = readingText.trim() + '\n\n' + questionText;
            }
        }
    }

    // Default answer key to first option if not found, preserving the imported question
    if (!correctAnswer) {
        correctAnswer = 'A';
    }

    if (finalOptions.length > 0) {
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
    
    // If still no options, save it as a text question instead of dropping it entirely
    return { 
        question: {
            text: questionText,
            type: 'text',
            correct: correctAnswer,
            mapel: metadata.subject || 'General',
            rombel: metadata.class || ''
        }, 
        nextIndex: i 
    };
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
    // This allows Mammoth output (which often uses <ol> for options) to map 1, 2, 3 to A, B, C
    const numericMatch = candidate.match(/^(\d+)(?:[\.\)\:\-\s]+)\s*(.+)$/);
    if (numericMatch && numericMatch[2].trim()) {
        const num = parseInt(numericMatch[1], 10);
        if (num >= 1 && num <= 6) {
            const letter = String.fromCharCode(64 + num); // 1->A, 2->B, etc.
            return { label: letter, text: numericMatch[2].trim() };
        }
    }

    // Accept pure bullet list items without labels as options too, but only if substantial
    if (bulletMatch && candidate.length > 3) {
        return { label: null, text: candidate };
    }

    return null;
}

module.exports = { parseWordDocument };
