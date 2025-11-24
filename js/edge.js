/**
 * Edge SMS CSV Processor
 * 
 * Edge SMS Column Structure:
 * - Student, Room/Form, Year, Date Assigned, Billable Item, Amount Owing
 * 
 * Key Differences from Kamar/Hero:
 * - Student name is in "Last Name, First Name" format (comma-separated)
 * - No student ID provided - must match using Name + Room + Year Level
 * - Seed roll is REQUIRED (not optional)
 * - No MOE numbers - student ID comes from seed roll as-is (no appending)
 * - No GST, Department, or Ledger data - uses defaults
 * - Uses fuzzy matching with 70% threshold for single candidates
 */

// Global variables for Edge processing
let edgeRawData = [];
let edgeSeedRoll = null;
let edgeFileName = "";
let edgeProcessedData = {
    payables: [],
    pcats: [],
    outstandings: [],
    removed: []
};
let edgeFlaggedMatches = [];

// Donation keywords (same as Kamar/Hero)
const EDGE_DONATION_KEYWORDS = ['donation', 'koha', 'charitable', 'giving', 'fundrais', 'sponsor', 'contribution'];

// Edge defaults
const EDGE_DEFAULTS = {
    GST_STATUS: 'GST',
    CATEGORY: 'General',
    LEDGER_CODE: '~LDC_Default'
};

// Initialize Edge SMS event listeners
document.addEventListener('DOMContentLoaded', function() {
    console.log('Edge SMS module loaded');
    
    // File upload
    const csvInputEdge = document.getElementById('csvInputEdge');
    const csvInputBtnEdge = document.getElementById('csvInputBtnEdge');
    
    csvInputBtnEdge?.addEventListener('click', () => {
        csvInputEdge?.click();
    });
    
    csvInputEdge?.addEventListener('change', handleEdgeFileUpload);
    
    // Seed roll
    const loadSeedRollBtnEdge = document.getElementById('loadSeedRollBtnEdge');
    loadSeedRollBtnEdge?.addEventListener('click', loadEdgeSeedRoll);
    
    // Filters toggle
    const filtersToggleEdge = document.getElementById('filtersToggleEdge');
    filtersToggleEdge?.addEventListener('click', toggleEdgeFilters);
    
    // Process button
    const processBtnEdge = document.getElementById('processBtnEdge');
    processBtnEdge?.addEventListener('click', processEdgeData);
    
    // Reset button
    const resetBtnEdge = document.getElementById('resetBtnEdge');
    resetBtnEdge?.addEventListener('click', resetEdgeApp);
    
    // Download buttons
    document.getElementById('payablesBtnEdge')?.addEventListener('click', () => downloadEdgeFile('payables'));
    document.getElementById('pcatsBtnEdge')?.addEventListener('click', () => downloadEdgeFile('pcats'));
    document.getElementById('outstandingsBtnEdge')?.addEventListener('click', () => downloadEdgeFile('outstandings'));
    document.getElementById('removedBtnEdge')?.addEventListener('click', () => downloadEdgeFile('removed'));
    document.getElementById('processedBtnEdge')?.addEventListener('click', () => downloadEdgeFile('processed'));
    document.getElementById('rawBtnEdge')?.addEventListener('click', () => downloadEdgeFile('raw'));
});

function handleEdgeFileUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    const file = files[0];
    const fileNameDiv = document.getElementById('fileNameEdge');
    
    // Store filename for year extraction
    edgeFileName = file.name;
    
    fileNameDiv.textContent = `Selected: ${file.name}`;
    fileNameDiv.className = 'file-status';
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const csv = e.target.result;
            const data = parseEdgeCSV(csv);
            
            edgeRawData = data;
            console.log(`Parsed ${edgeRawData.length} rows from Edge SMS`);
            fileNameDiv.textContent = `✓ Loaded ${edgeRawData.length} charges from ${file.name}`;
            fileNameDiv.className = 'file-status success';
            updateEdgeProcessButton();
        } catch (error) {
            console.error('Error parsing Edge file:', error);
            fileNameDiv.textContent = `Error: ${error.message}`;
            fileNameDiv.className = 'file-status error';
        }
    };
    
    reader.readAsText(file);
}

function parseEdgeCSV(csv) {
    const lines = csv.split('\n').filter(line => line.trim());
    if (lines.length < 2) throw new Error('CSV file is empty or invalid');
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const data = [];
    
    // Expected columns: Student, Room/Form, Year, Date Assigned, Billable Item, Amount Owing
    const colMap = {
        student: headers.findIndex(h => h.toLowerCase().includes('student')),
        room: headers.findIndex(h => h.toLowerCase().includes('room') || h.toLowerCase().includes('form')),
        year: headers.findIndex(h => h.toLowerCase().includes('year')),
        dateAssigned: headers.findIndex(h => h.toLowerCase().includes('date')),
        billableItem: headers.findIndex(h => h.toLowerCase().includes('billable') || h.toLowerCase().includes('item')),
        amountOwing: headers.findIndex(h => h.toLowerCase().includes('amount') || h.toLowerCase().includes('owing'))
    };
    
    // Validate required columns
    const missing = Object.entries(colMap).filter(([key, val]) => val === -1).map(([key]) => key);
    if (missing.length > 0) {
        throw new Error(`Missing required columns: ${missing.join(', ')}`);
    }
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        // Parse CSV with quoted fields support
        const cols = parseCSVLine(line);
        if (cols.length < 6) continue; // Skip incomplete rows
        
        const studentName = cols[colMap.student]?.trim() || '';
        const amountOwing = parseFloat(cols[colMap.amountOwing]?.replace(/[^0-9.-]/g, '')) || 0;
        
        // Skip if no student name or zero amount
        if (!studentName || amountOwing === 0) continue;
        
        data.push({
            studentName: studentName,
            room: cols[colMap.room]?.trim() || '',
            year: cols[colMap.year]?.trim() || '',
            dateAssigned: cols[colMap.dateAssigned]?.trim() || '',
            billableItem: cols[colMap.billableItem]?.trim() || '',
            amountOwing: amountOwing
        });
    }
    
    return data;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                current += '"';
                i++; // Skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    
    return result.map(field => field.trim().replace(/^"|"$/g, ''));
}

function loadEdgeSeedRoll() {
    const textarea = document.getElementById('seedRollPasteEdge');
    const statusDiv = document.getElementById('seedRollStatusEdge');
    let text = textarea.value.trim();
    
    if (!text) {
        statusDiv.textContent = '⚠ Please paste the seed roll data';
        statusDiv.className = 'status-message warning';
        return;
    }
    
    try {
        // Try JSON format first (Kindo JSON export)
        let matches;
        try {
            const seedData = JSON.parse(text);
            if (seedData.rtype === "roll_student_search_result" && Array.isArray(seedData.matches)) {
                matches = seedData.matches;
            } else {
                throw new Error('Invalid JSON structure');
            }
        } catch (jsonError) {
            // Fall back to TSV/CSV parsing (tab or comma-separated)
            matches = parseEdgeSeedRollTSV(text);
        }
        
        if (!matches || matches.length === 0) {
            throw new Error('No students found in seed roll data');
        }
        
        edgeSeedRoll = matches;
        console.log(`Loaded ${edgeSeedRoll.length} students from Edge seed roll`);
        
        statusDiv.textContent = `✓ Loaded ${edgeSeedRoll.length} students from seed roll`;
        statusDiv.className = 'status-message success';
        
        updateEdgeProcessButton();
        
    } catch (error) {
        console.error('Error parsing Edge seed roll:', error);
        statusDiv.innerHTML = `<strong>Error:</strong> ${error.message}`;
        statusDiv.className = 'status-message error';
    }
}

function parseEdgeSeedRollTSV(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const students = [];
    
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        
        // Try tab-separated first, then comma-separated
        let columns = trimmed.split('\t');
        if (columns.length === 1) {
            columns = trimmed.split(',');
        }
        
        const tag = (columns[0] || '').trim().toLowerCase();
        
        // Only parse student rows, ignore caregiver rows
        // Format: student [id] [first_names] [surname] [class_name] [year_level]
        if (tag === 'student' && columns.length >= 6) {
            const student = {
                student_id: (columns[1] || '').trim(),
                first_names: (columns[2] || '').trim(),
                surname: (columns[3] || '').trim(),
                class_name: (columns[4] || '').trim(),
                year_level: (columns[5] || '').trim()
            };
            
            // Only add if we have the essential fields
            if (student.student_id && student.first_names && student.surname) {
                students.push(student);
            }
        }
    });
    
    console.log(`Parsed ${students.length} students from TSV seed roll`);
    return students;
}

function updateEdgeProcessButton() {
    const processBtn = document.getElementById('processBtnEdge');
    if (processBtn) {
        processBtn.disabled = !(edgeRawData.length > 0 && edgeSeedRoll && edgeSeedRoll.length > 0);
    }
}

function toggleEdgeFilters() {
    const content = document.getElementById('filtersContentEdge');
    const icon = document.querySelector('#filtersToggleEdge .toggle-icon');
    if (content && icon) {
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▲' : '▼';
    }
}

function processEdgeData() {
    const statusDiv = document.getElementById('statusEdge');
    
    if (!edgeRawData || edgeRawData.length === 0) {
        statusDiv.textContent = '⚠ Please upload an Edge SMS CSV file first';
        statusDiv.className = 'status-message warning';
        return;
    }
    
    if (!edgeSeedRoll || edgeSeedRoll.length === 0) {
        statusDiv.textContent = '⚠ Seed roll is REQUIRED for Edge SMS. Please load the seed roll first.';
        statusDiv.className = 'status-message warning';
        return;
    }
    
    statusDiv.textContent = 'Processing...';
    statusDiv.className = 'status-message';
    
    // Get filters
    const excludeStudents = document.getElementById('excludeStudentsTextareaEdge')?.value || '';
    const excludeStudentIds = excludeStudents.split('\n').map(id => id.trim()).filter(id => id);
    
    const excludeDesc = document.getElementById('removeNamesTextareaEdge')?.value || '';
    const excludeKeywords = excludeDesc.split('\n').map(k => k.trim().toLowerCase()).filter(k => k);
    
    // Reset processed data
    edgeProcessedData = {
        payables: new Map(),
        pcats: new Set(),
        outstandings: [],
        removed: [],
        processed: []
    };
    edgeFlaggedMatches = [];
    
    // Clear duplicates container
    const duplicatesContainer = document.getElementById('duplicatesContainerEdge');
    if (duplicatesContainer) {
        duplicatesContainer.innerHTML = '';
    }
    
    // Track prices for each payable to find the most common
    const payablePrices = new Map(); // payableName -> array of prices
    
    // Extract year from filename as a fallback
    let filenameYear = "";
    if (edgeFileName) {
        const match = edgeFileName.match(/\b(20\d{2})\b/);
        if (match) {
            filenameYear = match[1];
        }
    }
    
    // Track last known year for fallback (starts with filename year if available)
    let lastKnownYear = filenameYear;
    
    // Process each charge
    for (const row of edgeRawData) {
        // Apply description exclusion
        const billableItemLower = row.billableItem.toLowerCase();
        if (excludeKeywords.some(kw => billableItemLower.includes(kw))) {
            edgeProcessedData.removed.push({
                ...row,
                reason: 'Billable item excluded'
            });
            continue;
        }
        
        // Parse student name (format: "Last Name, First Name")
        const nameParts = row.studentName.split(',').map(s => s.trim());
        if (nameParts.length < 2) {
            edgeProcessedData.removed.push({
                ...row,
                reason: 'Invalid name format (expected "Last Name, First Name")'
            });
            continue;
        }
        
        const lastName = nameParts[0];
        const firstName = nameParts[1];
        
        // Match student by name + room + year level
        const matchResult = matchEdgeStudentByNameRoomYear(
            firstName,
            lastName,
            row.room,
            row.year,
            edgeSeedRoll
        );
        
        if (!matchResult || !matchResult.matched) {
            const reason = matchResult ? matchResult.reason : 'No match found';
            const potentialMatches = matchResult && matchResult.potentialMatches 
                ? matchResult.potentialMatches.map(m => m.details).join(' | ')
                : 'None';
            
            edgeProcessedData.removed.push({
                ...row,
                firstName,
                lastName,
                reason: reason,
                potentialMatches: potentialMatches
            });
            continue;
        }
        
        if (matchResult.needsReview) {
            edgeFlaggedMatches.push({
                row: { ...row, firstName, lastName },
                candidates: matchResult.candidates,
                reason: matchResult.reason || 'Multiple matches found'
            });
            continue;
        }
        
        // Check if student is excluded
        if (excludeStudentIds.includes(matchResult.studentId)) {
            edgeProcessedData.removed.push({
                ...row,
                firstName,
                lastName,
                reason: 'Student excluded'
            });
            continue;
        }
        
        // Create Kindo Friendly payable name (with year prepended)
        const result = generateEdgePayableName(row.billableItem, row.dateAssigned, lastKnownYear);
        const payableName = result.payableName;
        
        // Update lastKnownYear if a year was found
        if (result.extractedYear) {
            lastKnownYear = result.extractedYear;
        }
        
        // Track prices for this payable
        if (!payablePrices.has(payableName)) {
            payablePrices.set(payableName, []);
        }
        payablePrices.get(payableName).push(row.amountOwing);
        
        // Add to processed data (for review file)
        edgeProcessedData.processed.push({
            student_id: matchResult.studentId,
            firstName,
            lastName,
            room: row.room,
            year: row.year,
            payable_name: payableName,
            amount_owing: row.amountOwing,
            date_assigned: row.dateAssigned
        });
        
        // Add to outstandings
        edgeProcessedData.outstandings.push({
            student_id: matchResult.studentId,
            payable_name: payableName,
            amount: row.amountOwing,
            caregiver_id: ''
        });
    }
    
    // Generate payables with most common price (or highest if tie)
    payablePrices.forEach((prices, payableName) => {
        const priceToUse = getMostCommonOrHighestPrice(prices);
        
        // Check if donation
        const isDonation = EDGE_DONATION_KEYWORDS.some(kw => 
            payableName.toLowerCase().includes(kw)
        );
        
        edgeProcessedData.payables.set(payableName, {
            product_name: payableName,
            product_remarks2: '',
            product_gst_status: EDGE_DEFAULTS.GST_STATUS,
            product_is_donation: isDonation ? 'TRUE' : 'FALSE',
            product_ledgercode_or_remarks1: EDGE_DEFAULTS.LEDGER_CODE,
            product_price_in_dollars: priceToUse,
            is_voluntary: isDonation ? 'yes' : 'no'
        });
        
        // Add to pcats (all use default category)
        edgeProcessedData.pcats.add(`${payableName}\t${EDGE_DEFAULTS.CATEGORY}`);
    });
    
    // Convert payables Map to array
    edgeProcessedData.payables = Array.from(edgeProcessedData.payables.values());
    
    // Show results
    displayEdgeResults();
    
    // Show flagged matches if any
    if (edgeFlaggedMatches.length > 0) {
        displayEdgeFlaggedMatches();
    }
    
    statusDiv.textContent = '✓ Processing complete!';
    statusDiv.className = 'status-message success';
}

function generateEdgePayableName(billableItem, dateAssigned, fallbackYear = "") {
    let product_name = billableItem || "";
    
    // Extract year - priority: billable item name, then date column
    let year = "";
    console.log('generateEdgePayableName called with:', { billableItem, dateAssigned, fallbackYear });
    
    // First, try to extract from billable item name
    if (billableItem) {
        const match = billableItem.match(/\b(20\d{2})\b/);
        if (match) {
            year = match[1];
        }
    }
    
    // If no year from name, try date column (format: DD/MM/YYYY or DD/MM/YY)
    if (!year && dateAssigned && typeof dateAssigned === 'string' && dateAssigned.trim()) {
        // Try DD/MM/YYYY format (4-digit year)
        let match = dateAssigned.match(/\/(\d{4})$/);
        if (match) {
            year = match[1];
        } else {
            // Try DD/MM/YY format (2-digit year)
            match = dateAssigned.match(/\/(\d{2})$/);
            if (match) {
                const twoDigitYear = parseInt(match[1], 10);
                // Convert 2-digit year to 4-digit (assume 2000s)
                year = (twoDigitYear < 50 ? 2000 + twoDigitYear : 1900 + twoDigitYear).toString();
            } else {
                // Try YYYY-MM-DD format (year at start)
                match = dateAssigned.match(/^(\d{4})/);
                if (match) {
                    year = match[1];
                }
            }
        }
    }
    
    // If still no year, use the fallback from previous row
    if (!year && fallbackYear) {
        year = fallbackYear;
    }
    
    console.log('Extracted year:', year);
    
    // If year is available, prepend it and remove duplicate standalone years
    if (year) {
        // Only remove standalone 4-digit years (not part of dates like "26/06/2025")
        // Use negative lookbehind/lookahead to avoid removing years in date formats
        const yearRegex = new RegExp(`(?<!\\d/)\\b${year}\\b(?!/\\d)`, 'g');
        product_name = product_name.replace(yearRegex, '').replace(/\s{2,}/g, ' ').trim();
        product_name = `${year} ${product_name}`.trim();
        console.log('After year prepending:', product_name);
        
        let prev;
        do {
            prev = product_name;
            product_name = product_name.replace(/(\(\s*\)|\[\s*\]|\{\s*\})/g, '').replace(/\s{2,}/g, ' ').trim();
        } while (product_name !== prev);
    }
    
    // Convert accented letters to base ASCII (e.g., Māori → Maori)
    if (typeof product_name.normalize === 'function') {
        product_name = product_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    
    // Sanitize to only include allowed characters
    product_name = product_name.replace(/[^a-zA-Z0-9 .%!&)()\-,/:_@#'$?+\t]/g, '').replace(/\s{2,}/g, ' ').trim();
    
    // Ensure length is within 1-100 characters
    if (product_name.length > 100) {
        product_name = product_name.substring(0, 100).trim();
    }
    if (product_name.length === 0) {
        product_name = "Unnamed Payable";
    }
    
    console.log('Final product_name:', product_name);
    return {
        payableName: product_name,
        extractedYear: year // Return the year so we can track it for next row
    };
}

function getMostCommonOrHighestPrice(prices) {
    if (prices.length === 1) return prices[0];
    
    // Count frequency of each price
    const frequency = new Map();
    prices.forEach(price => {
        frequency.set(price, (frequency.get(price) || 0) + 1);
    });
    
    // Find price(s) with highest frequency
    let maxFreq = 0;
    frequency.forEach(freq => {
        if (freq > maxFreq) maxFreq = freq;
    });
    
    const mostCommon = [];
    frequency.forEach((freq, price) => {
        if (freq === maxFreq) mostCommon.push(price);
    });
    
    // If tie, return highest price
    return Math.max(...mostCommon);
}

function matchEdgeStudentByNameRoomYear(firstName, lastName, room, year, seedRoll) {
    // Normalize inputs
    const normalizedRoom = room.replace(/^Room\s*/i, '').trim();
    const normalizedYear = year.toString().trim();
    const searchFirst = firstName.toLowerCase().trim();
    const searchLast = lastName.toLowerCase().trim();
    
    // Step 1: Try exact name match
    const exactNameMatches = seedRoll.filter(student => {
        const studentFirst = (student.first_names || '').toLowerCase().trim();
        const studentLast = (student.surname || '').toLowerCase().trim();
        return studentFirst === searchFirst && studentLast === searchLast;
    });
    
    // If single exact name match - trust it! (ignore room/year mismatches)
    if (exactNameMatches.length === 1) {
        return {
            matched: true,
            studentId: exactNameMatches[0].student_id,
            needsReview: false
        };
    }
    
    // Multiple exact name matches - narrow by year level first (more reliable than room)
    if (exactNameMatches.length > 1) {
        const yearMatches = exactNameMatches.filter(student => {
            const studentYear = (student.year_level || '').toString().trim();
            return studentYear === normalizedYear;
        });
        
        // Single match after filtering by year - use it
        if (yearMatches.length === 1) {
            return {
                matched: true,
                studentId: yearMatches[0].student_id,
                needsReview: false
            };
        }
        
        // Still multiple after year filter - try room as tiebreaker
        if (yearMatches.length > 1) {
            const roomMatches = yearMatches.filter(student => {
                const studentRoom = (student.class_name || '').replace(/^Room\s*/i, '').trim();
                return studentRoom === normalizedRoom;
            });
            
            if (roomMatches.length === 1) {
                return {
                    matched: true,
                    studentId: roomMatches[0].student_id,
                    needsReview: false
                };
            }
            
            // Still multiple - flag for review
            return {
                matched: false,
                needsReview: true,
                candidates: roomMatches.length > 0 ? roomMatches : yearMatches,
                reason: `Multiple students with same name and year (${yearMatches.length} found)`
            };
        }
        
        // No year matches - flag all exact name matches for review
        return {
            matched: false,
            needsReview: true,
            candidates: exactNameMatches,
            reason: `Multiple students with exact name match (${exactNameMatches.length} found)`
        };
    }
    
    // Step 2: No exact match - filter by room+year first, then fuzzy match names
    const roomYearPool = seedRoll.filter(student => {
        const studentRoom = (student.class_name || '').replace(/^Room\s*/i, '').trim();
        const studentYear = (student.year_level || '').toString().trim();
        return studentRoom === normalizedRoom && studentYear === normalizedYear;
    });
    
    if (roomYearPool.length === 0) {
        // No students in this room+year - try fuzzy across whole seed roll
        const fuzzyMatches = findEdgeFuzzyMatches(firstName, lastName, room, year, seedRoll);
        return {
            matched: false,
            reason: 'No students found in matching room/year',
            potentialMatches: fuzzyMatches
        };
    }
    
    // Calculate similarity for students in room+year pool
    const similarities = roomYearPool.map(student => {
        const studentFirst = (student.first_names || '').toLowerCase().trim();
        const studentLast = (student.surname || '').toLowerCase().trim();
        
        const firstSim = calculateEdgeSimilarity(searchFirst, studentFirst);
        const lastSim = calculateEdgeSimilarity(searchLast, studentLast);
        const avgSim = (firstSim + lastSim) / 2;
        
        return { student, similarity: avgSim };
    });
    
    // Sort by similarity
    similarities.sort((a, b) => b.similarity - a.similarity);
    
    // Filter candidates with ≥70% similarity
    const candidates = similarities.filter(s => s.similarity >= 0.7);
    
    if (candidates.length === 0) {
        // No good matches - try fuzzy across whole seed roll
        const fuzzyMatches = findEdgeFuzzyMatches(firstName, lastName, room, year, seedRoll);
        return {
            matched: false,
            reason: 'No similar names found in matching room/year',
            potentialMatches: fuzzyMatches
        };
    }
    
    if (candidates.length === 1) {
        // Single candidate ≥70% - auto-match
        return {
            matched: true,
            studentId: candidates[0].student.student_id,
            needsReview: false,
            similarity: Math.round(candidates[0].similarity * 100)
        };
    }
    
    // Multiple candidates ≥70% - flag for review
    return {
        matched: false,
        needsReview: true,
        candidates: candidates.map(c => c.student),
        reason: `Multiple similar matches found in room/year (${candidates.length} students ≥70% similar)`
    };
}

function findEdgeFuzzyMatches(firstName, lastName, room, year, seedRoll) {
    const searchFirst = firstName.toLowerCase().trim();
    const searchLast = lastName.toLowerCase().trim();
    const matches = [];
    
    seedRoll.forEach(student => {
        const studentFirst = (student.first_names || '').toLowerCase().trim();
        const studentLast = (student.surname || '').toLowerCase().trim();
        
        const firstSim = calculateEdgeSimilarity(searchFirst, studentFirst);
        const lastSim = calculateEdgeSimilarity(searchLast, studentLast);
        const avgSim = (firstSim + lastSim) / 2;
        
        // Include if similarity is above 60%
        if (avgSim >= 0.6) {
            matches.push({
                student,
                similarity: avgSim,
                details: `${student.first_names} ${student.surname} (${student.class_name || 'No room'}, Year ${student.year_level || '?'}) - ${Math.round(avgSim * 100)}% match`
            });
        }
    });
    
    // Sort by similarity (highest first)
    matches.sort((a, b) => b.similarity - a.similarity);
    
    // Return top 5 matches
    return matches.slice(0, 5);
}

function calculateEdgeSimilarity(str1, str2) {
    // Levenshtein distance algorithm
    if (str1 === str2) return 1.0;
    if (str1.length === 0 || str2.length === 0) return 0.0;
    
    const matrix = [];
    
    // Initialize matrix
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    // Fill matrix
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    
    const distance = matrix[str2.length][str1.length];
    const maxLength = Math.max(str1.length, str2.length);
    return 1 - (distance / maxLength);
}

function displayEdgeResults() {
    const resultsSection = document.getElementById('resultsSectionEdge');
    const statsContainer = document.getElementById('statsContainerEdge');
    
    const payablesCount = edgeProcessedData.payables.length;
    const pcatsCount = edgeProcessedData.pcats.size;
    const outstandingsCount = edgeProcessedData.outstandings.length;
    const removedCount = edgeProcessedData.removed.length;
    const flaggedCount = edgeFlaggedMatches.length;
    
    statsContainer.innerHTML = `
        <div class="info-box">
            <strong>Processing Complete!</strong>
            <ul>
                <li>Unique Payables: ${payablesCount} items</li>
                <li>Parent Categories: ${pcatsCount} unique</li>
                <li>Outstanding Charges: ${outstandingsCount} records</li>
                <li>Removed Charges: ${removedCount}</li>
                ${flaggedCount > 0 ? `<li style="color: #e65100;">⚠ Flagged for Review: ${flaggedCount} students</li>` : ''}
            </ul>
        </div>
    `;
    
    // Enable download buttons
    document.getElementById('payablesBtnEdge').disabled = false;
    document.getElementById('pcatsBtnEdge').disabled = false;
    document.getElementById('outstandingsBtnEdge').disabled = false;
    document.getElementById('removedBtnEdge').disabled = false;
    document.getElementById('processedBtnEdge').disabled = false;
    document.getElementById('rawBtnEdge').disabled = false;
    
    // Display removed with potential matches
    displayEdgeRemovedWithMatches();
    
    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

function displayEdgeRemovedWithMatches() {
    const removedWithMatches = edgeProcessedData.removed.filter(r => 
        r.potentialMatches && r.potentialMatches !== 'None'
    );
    
    if (removedWithMatches.length === 0) return;
    
    const duplicatesContainer = document.getElementById('duplicatesContainerEdge');
    
    let html = `
        <div class="card" style="border-color: #2196F3; background: #e3f2fd; margin-top: 16px;">
            <div class="card-header">
                <h3>ℹ Removed Students with Potential Matches (${removedWithMatches.length})</h3>
            </div>
            <p>The following students were removed but have similar names in the seed roll (60%+ match). This is for your information only.</p>
            <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 16px;">
    `;
    
    removedWithMatches.forEach((item, index) => {
        html += `
            <div style="padding: 12px; background: white; border: 1px solid #90caf9; border-radius: 4px;">
                <div>
                    <strong>${item.firstName || ''} ${item.lastName || ''}</strong> 
                    (Room: ${item.room}, Year: ${item.year}) - $${item.amountOwing.toFixed(2)}
                    <br>
                    <small style="color: #666;"><strong>Reason:</strong> ${item.reason}</small>
                    <br>
                    <small style="color: #1976d2;"><strong>Potential Matches:</strong> ${item.potentialMatches}</small>
                </div>
            </div>
        `;
    });
    
    html += `
            </div>
        </div>
    `;
    
    const existingContent = duplicatesContainer.innerHTML;
    duplicatesContainer.innerHTML = existingContent + html;
}

function displayEdgeFlaggedMatches() {
    const duplicatesContainer = document.getElementById('duplicatesContainerEdge');
    
    let html = `
        <div class="card" style="border-color: #ff9800; background: #fff8f0;">
            <div class="card-header">
                <h3>⚠ Students Requiring Manual Review (${edgeFlaggedMatches.length})</h3>
            </div>
            <p>The following students could not be automatically matched. Please select the correct student for each:</p>
            <div class="flagged-list" style="display: flex; flex-direction: column; gap: 16px; margin-top: 16px;">
    `;
    
    edgeFlaggedMatches.forEach((item, index) => {
        const row = item.row;
        const reason = item.reason || 'Multiple matches found';
        html += `
            <div class="flagged-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: white; border: 1px solid #e1e8ed; border-radius: 4px;">
                <div class="flagged-info">
                    <strong>${row.firstName} ${row.lastName}</strong> 
                    (Room: ${row.room}, Year: ${row.year})
                    <br>
                    <small style="color: #666;">Charge: ${row.billableItem} - $${row.amountOwing.toFixed(2)}</small>
                    <br>
                    <small style="color: #ff9800;"><strong>Reason:</strong> ${reason}</small>
                </div>
                <div class="flagged-select" style="min-width: 300px;">
                    <select id="flaggedSelectEdge${index}" class="flagged-dropdown" style="width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 14px;">
                        <option value="">-- Select Student --</option>
                        ${item.candidates.map(student => `
                            <option value="${student.student_id}">
                                ${student.first_names} ${student.surname} 
                                (${student.class_name || 'No room'}, Year ${student.year_level || '?'})
                                - ID: ${student.student_id}
                            </option>
                        `).join('')}
                    </select>
                </div>
            </div>
        `;
    });
    
    html += `
            </div>
            <button id="applyFlaggedMatchesEdge" class="btn-primary" style="margin-top: 16px;">Apply Selections & Re-process</button>
        </div>
    `;
    
    duplicatesContainer.innerHTML = html;
    duplicatesContainer.style.display = 'block';
    
    // Add event listener for apply button
    document.getElementById('applyFlaggedMatchesEdge')?.addEventListener('click', applyEdgeFlaggedSelections);
}

function applyEdgeFlaggedSelections() {
    console.log('Applying flagged selections...');
    alert('Manual selection feature - select students and click Process Data again to include them.');
}

function downloadEdgeFile(type) {
    let csvContent = '';
    let filename = '';
    const schoolName = document.getElementById('schoolNameInputEdge')?.value || 'edge';
    const schoolSlug = schoolName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    
    switch(type) {
        case 'payables':
            csvContent = 'product_name,product_remarks2,product_gst_status,product_is_donation,product_ledgercode_or_remarks1,product_price_in_dollars,is_voluntary\n';
            csvContent += edgeProcessedData.payables.map(p => 
                [p.product_name, p.product_remarks2, p.product_gst_status, p.product_is_donation, p.product_ledgercode_or_remarks1, p.product_price_in_dollars, p.is_voluntary].map(escapeEdgeCSV).join(',')
            ).join('\n');
            filename = `${schoolSlug}_payables.csv`;
            break;
            
        case 'pcats':
            csvContent = 'proto_payable_name,pcat\n';
            csvContent += Array.from(edgeProcessedData.pcats).map(row => {
                const [name, cat] = row.split('\t');
                return [name, cat].map(escapeEdgeCSV).join(',');
            }).join('\n');
            filename = `${schoolSlug}_pcats.csv`;
            break;
            
        case 'outstandings':
            csvContent = 'student_id,payable_name,amount,caregiver_id\n';
            csvContent += edgeProcessedData.outstandings.map(o => 
                [o.student_id, o.payable_name, o.amount, o.caregiver_id].map(escapeEdgeCSV).join(',')
            ).join('\n');
            filename = `${schoolSlug}_outstandings.csv`;
            break;
            
        case 'removed':
            csvContent = 'First Name,Last Name,Room,Year,Billable Item,Amount,Reason\n';
            csvContent += edgeProcessedData.removed.map(r => 
                [r.firstName || '', r.lastName || '', r.room, r.year, r.billableItem, r.amountOwing, r.reason].map(escapeEdgeCSV).join(',')
            ).join('\n');
            filename = `${schoolSlug}_removed.csv`;
            break;
            
        case 'processed':
            csvContent = 'student_id,first_name,last_name,room,year,payable_name,amount_owing,date_assigned\n';
            csvContent += edgeProcessedData.processed.map(p => 
                [p.student_id, p.firstName, p.lastName, p.room, p.year, p.payable_name, p.amount_owing, p.date_assigned].map(escapeEdgeCSV).join(',')
            ).join('\n');
            filename = `${schoolSlug}_processed.csv`;
            break;
            
        case 'raw':
            csvContent = 'Student,Room/Form,Year,Date Assigned,Billable Item,Amount Owing\n';
            csvContent += edgeRawData.map(r => 
                [r.studentName, r.room, r.year, r.dateAssigned, r.billableItem, r.amountOwing].map(escapeEdgeCSV).join(',')
            ).join('\n');
            filename = `${schoolSlug}_raw.csv`;
            break;
            
        default:
            console.error('Unknown file type:', type);
            return;
    }
    
    downloadEdgeCSV(csvContent, filename);
}

function escapeEdgeCSV(value) {
    if (value == null) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function downloadEdgeCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

function resetEdgeApp() {
    edgeRawData = [];
    edgeSeedRoll = null;
    edgeProcessedData = { payables: [], pcats: [], outstandings: [], removed: [], processed: [] };
    edgeFlaggedMatches = [];
    
    document.getElementById('csvInputEdge').value = '';
    document.getElementById('fileNameEdge').textContent = '';
    document.getElementById('seedRollPasteEdge').value = '';
    document.getElementById('seedRollStatusEdge').textContent = '';
    document.getElementById('excludeStudentsTextareaEdge').value = '';
    document.getElementById('removeNamesTextareaEdge').value = '';
    document.getElementById('resultsSectionEdge').style.display = 'none';
    document.getElementById('duplicatesContainerEdge').innerHTML = '';
    
    // Disable process and download buttons
    document.getElementById('processBtnEdge').disabled = true;
    document.getElementById('payablesBtnEdge').disabled = true;
    document.getElementById('pcatsBtnEdge').disabled = true;
    document.getElementById('outstandingsBtnEdge').disabled = true;
    document.getElementById('removedBtnEdge').disabled = true;
    document.getElementById('processedBtnEdge').disabled = true;
    document.getElementById('rawBtnEdge').disabled = true;
    
    console.log('Edge app reset');
}
