/**
 * Hero SMS CSV Processor
 * 
 * Hero SMS Column Structure:
 * - ID, Date, Ledger, Line Item, Description, Student ID, Last Name, First Name, Room, Year Level, Debit, Credit, Balance
 * 
 * Key Differences from Kamar:
 * - Student ID column is NOT usable for matching
 * - Must match using: Last Name + First Name + Room + Year Level
 * - Seed roll is REQUIRED (not optional)
 * - No MOE numbers in Hero data - must come from seed roll
 * - Student ID in output is from seed roll as-is (no MOE appending)
 */

// Global variables for Hero processing
let heroRawData = [];
let heroSeedRoll = null;
let heroProcessedData = {
    payables: [],
    pcats: [],
    outstandings: [],
    removed: []
};
let heroFlaggedMatches = [];

// Donation keywords (same as Kamar)
const DONATION_KEYWORDS = ['donation', 'koha', 'charitable', 'giving', 'fundrais', 'sponsor'];

// Initialize Hero SMS event listeners
document.addEventListener('DOMContentLoaded', function() {
    console.log('Hero SMS module loaded');
    
    // File upload
    const csvInputHero = document.getElementById('csvInputHero');
    const csvInputBtnHero = document.getElementById('csvInputBtnHero');
    
    csvInputBtnHero?.addEventListener('click', () => {
        csvInputHero?.click();
    });
    
    csvInputHero?.addEventListener('change', handleHeroFileUpload);
    
    // Seed roll
    const loadSeedRollBtnHero = document.getElementById('loadSeedRollBtnHero');
    loadSeedRollBtnHero?.addEventListener('click', loadHeroSeedRoll);
    
    // Filters toggle
    const filtersToggleHero = document.getElementById('filtersToggleHero');
    filtersToggleHero?.addEventListener('click', toggleHeroFilters);
    
    // Process button
    const processBtnHero = document.getElementById('processBtnHero');
    processBtnHero?.addEventListener('click', processHeroData);
    
    // Reset button
    const resetBtnHero = document.getElementById('resetBtnHero');
    resetBtnHero?.addEventListener('click', resetHeroApp);
    
    // Download buttons
    document.getElementById('payablesBtnHero')?.addEventListener('click', () => downloadHeroFile('payables'));
    document.getElementById('pcatsBtnHero')?.addEventListener('click', () => downloadHeroFile('pcats'));
    document.getElementById('outstandingsBtnHero')?.addEventListener('click', () => downloadHeroFile('outstandings'));
    document.getElementById('removedBtnHero')?.addEventListener('click', () => downloadHeroFile('removed'));
});

function handleHeroFileUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    const file = files[0];
    const fileNameDiv = document.getElementById('fileNameHero');
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    
    fileNameDiv.textContent = `Selected: ${file.name}`;
    fileNameDiv.className = 'file-status';
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            let data;
            
            if (isExcel) {
                // Parse Excel file using SheetJS
                const arrayBuffer = e.target.result;
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                
                // Convert to CSV format
                const csv = XLSX.utils.sheet_to_csv(worksheet, { FS: '\t' });
                data = parseHeroCSV(csv);
            } else {
                // Parse CSV file
                const csv = e.target.result;
                data = parseHeroCSV(csv);
            }
            
            heroRawData = data;
            console.log(`Parsed ${heroRawData.length} rows from Hero SMS`);
            fileNameDiv.textContent = `✓ Loaded ${heroRawData.length} transactions from ${file.name}`;
            fileNameDiv.className = 'file-status success';
            updateProcessButton();
        } catch (error) {
            console.error('Error parsing Hero file:', error);
            fileNameDiv.textContent = `Error: ${error.message}`;
            fileNameDiv.className = 'file-status error';
        }
    };
    
    if (isExcel) {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file);
    }
}

function parseHeroCSV(csv) {
    const lines = csv.split('\n').filter(line => line.trim());
    if (lines.length < 2) throw new Error('CSV file is empty or invalid');
    
    const headers = lines[0].split('\t').map(h => h.trim());
    const data = [];
    
    // Expected columns: ID, Date, Ledger, Line Item, Description, Student ID, Last Name, First Name, Room, Year Level, Debit, Credit, Balance
    const colMap = {
        date: headers.indexOf('Date'),
        ledger: headers.indexOf('Ledger'),
        lineItem: headers.indexOf('Line Item'),
        description: headers.indexOf('Description'),
        lastName: headers.indexOf('Last Name'),
        firstName: headers.indexOf('First Name'),
        room: headers.indexOf('Room'),
        yearLevel: headers.indexOf('Year Level'),
        debit: headers.indexOf('Debit'),
        credit: headers.indexOf('Credit'),
        balance: headers.indexOf('Balance')
    };
    
    // Validate required columns
    const missing = Object.entries(colMap).filter(([key, val]) => val === -1).map(([key]) => key);
    if (missing.length > 0) {
        throw new Error(`Missing required columns: ${missing.join(', ')}`);
    }
    
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split('\t');
        if (cols.length < 10) continue; // Skip incomplete rows
        
        data.push({
            date: cols[colMap.date]?.trim() || '',
            ledger: cols[colMap.ledger]?.trim() || '',
            lineItem: cols[colMap.lineItem]?.trim() || '',
            description: cols[colMap.description]?.trim() || '',
            lastName: cols[colMap.lastName]?.trim() || '',
            firstName: cols[colMap.firstName]?.trim() || '',
            room: cols[colMap.room]?.trim() || '',
            yearLevel: cols[colMap.yearLevel]?.trim() || '',
            debit: parseFloat(cols[colMap.debit]) || 0,
            credit: parseFloat(cols[colMap.credit]) || 0,
            balance: parseFloat(cols[colMap.balance]) || 0
        });
    }
    
    return data;
}

function loadHeroSeedRoll() {
    const textarea = document.getElementById('seedRollPasteHero');
    const statusDiv = document.getElementById('seedRollStatusHero');
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
            matches = parseSeedRollTSV(text);
        }
        
        if (!matches || matches.length === 0) {
            throw new Error('No students found in seed roll data');
        }
        
        heroSeedRoll = matches;
        console.log(`Loaded ${heroSeedRoll.length} students from Hero seed roll`);
        
        statusDiv.textContent = `✓ Loaded ${heroSeedRoll.length} students from seed roll`;
        statusDiv.className = 'status-message success';
        
        updateProcessButton();
        
    } catch (error) {
        console.error('Error parsing Hero seed roll:', error);
        statusDiv.innerHTML = `<strong>Error:</strong> ${error.message}`;
        statusDiv.className = 'status-message error';
    }
}

function parseSeedRollTSV(text) {
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
        // Ignore caregiver rows - they start with empty column[0] or 'caregiver'
    });
    
    console.log(`Parsed ${students.length} students from TSV seed roll`);
    return students;
}

function updateProcessButton() {
    const processBtn = document.getElementById('processBtnHero');
    if (processBtn) {
        processBtn.disabled = !(heroRawData.length > 0 && heroSeedRoll && heroSeedRoll.length > 0);
    }
}

function toggleHeroFilters() {
    const content = document.getElementById('filtersContentHero');
    const icon = document.querySelector('#filtersToggleHero .toggle-icon');
    if (content && icon) {
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▲' : '▼';
    }
}

function processHeroData() {
    const statusDiv = document.getElementById('statusHero');
    
    if (!heroRawData || heroRawData.length === 0) {
        statusDiv.textContent = '⚠ Please upload a Hero SMS CSV file first';
        statusDiv.className = 'status-message warning';
        return;
    }
    
    if (!heroSeedRoll || heroSeedRoll.length === 0) {
        statusDiv.textContent = '⚠ Seed roll is REQUIRED for Hero SMS. Please load the seed roll first.';
        statusDiv.className = 'status-message warning';
        return;
    }
    
    statusDiv.textContent = 'Processing...';
    statusDiv.className = 'status-message';
    
    // Get filters
    const excludeStudents = document.getElementById('excludeStudentsTextareaHero')?.value || '';
    const excludeStudentIds = excludeStudents.split('\n').map(id => id.trim()).filter(id => id);
    
    const excludeDesc = document.getElementById('removeNamesTextareaHero')?.value || '';
    const excludeKeywords = excludeDesc.split('\n').map(k => k.trim().toLowerCase()).filter(k => k);
    
    // Reset processed data
    heroProcessedData = {
        payables: new Map(),
        pcats: new Set(),
        outstandings: [],
        removed: []
    };
    heroFlaggedMatches = [];
    
    // Clear duplicates container
    const duplicatesContainer = document.getElementById('duplicatesContainerHero');
    if (duplicatesContainer) {
        duplicatesContainer.innerHTML = '';
    }
    
    // Process each transaction
    for (const row of heroRawData) {
        // Apply description exclusion
        const fullDesc = `${row.lineItem} ${row.description}`.toLowerCase();
        if (excludeKeywords.some(kw => fullDesc.includes(kw))) {
            heroProcessedData.removed.push({
                ...row,
                reason: 'Description excluded'
            });
            continue;
        }
        
        // Skip if balance is 0
        if (row.balance === 0) {
            heroProcessedData.removed.push({
                ...row,
                reason: 'Zero balance'
            });
            continue;
        }
        
        // Match student by name + room + year level
        const matchResult = matchStudentByNameAndRoom(
            row.lastName,
            row.firstName,
            row.room,
            row.yearLevel,
            heroSeedRoll
        );
        
        if (!matchResult || !matchResult.matched) {
            const reason = matchResult ? matchResult.reason : 'No name match found';
            const potentialMatches = matchResult && matchResult.potentialMatches 
                ? matchResult.potentialMatches.map(m => m.details).join(' | ')
                : 'None';
            
            heroProcessedData.removed.push({
                ...row,
                reason: reason,
                potentialMatches: potentialMatches
            });
            continue;
        }
        
        if (matchResult.needsReview) {
            heroFlaggedMatches.push({
                row,
                candidates: matchResult.candidates,
                reason: matchResult.reason || 'Multiple matches found'
            });
            continue;
        }
        
        // Check if student is excluded
        if (excludeStudentIds.includes(matchResult.studentId)) {
            heroProcessedData.removed.push({
                ...row,
                reason: 'Student excluded'
            });
            continue;
        }
        
        // Create Kindo Friendly payable name (with year prepended)
        const payableName = generateHeroPayableName(row.lineItem, row.description, row.date);
        
        // Parse category from ledger (e.g., "21200 - Camp" -> "Camp")
        const category = parseCategoryFromLedger(row.ledger);
        
        // Extract ledger code (e.g., "21200 - Camp" -> "21200")
        const ledgerCode = extractLedgerCode(row.ledger);
        const productLedgerCode = ledgerCode ? `~LDC_${ledgerCode}` : '';
        
        // Check if donation
        const isDonation = DONATION_KEYWORDS.some(kw => 
            payableName.toLowerCase().includes(kw) || 
            category.toLowerCase().includes(kw)
        );
        
        // GST status - GST by default, no GST for donations
        const gstStatus = isDonation ? 'no GST' : 'GST';
        
        // Add to payables (use Map to avoid duplicates)
        if (!heroProcessedData.payables.has(payableName)) {
            heroProcessedData.payables.set(payableName, {
                product_name: payableName,
                product_remarks2: '',
                product_gst_status: gstStatus,
                product_is_donation: isDonation ? 'TRUE' : 'FALSE',
                product_ledgercode_or_remarks1: productLedgerCode,
                product_price_in_dollars: row.debit,
                is_voluntary: isDonation ? 'yes' : 'no'
            });
        }
        
        // Add to pcats
        heroProcessedData.pcats.add(`${payableName}\t${category}`);
        
        // Add to outstandings
        heroProcessedData.outstandings.push({
            student_id: matchResult.studentId,
            payable_name: payableName,
            amount: row.balance,
            caregiver_id: ''
        });
    }
    
    // Convert payables Map to array
    heroProcessedData.payables = Array.from(heroProcessedData.payables.values());
    
    // Show results
    displayHeroResults();
    
    // Show flagged matches if any
    if (heroFlaggedMatches.length > 0) {
        displayFlaggedMatches();
    }
    
    statusDiv.textContent = '✓ Processing complete!';
    statusDiv.className = 'status-message success';
}

function generateHeroPayableName(lineItem, description, date) {
    // Combine line item and description
    let product_name = description 
        ? `${lineItem} - ${description}`.trim()
        : lineItem.trim();
    
    // Extract year from date (format: YYYY-MM-DD)
    let year = null;
    if (date) {
        const match = date.match(/^(\d{4})/);
        if (match) {
            year = match[1];
        }
    }
    
    // If year is available, prepend it and remove duplicate years
    if (year) {
        // Remove the same year if it appears in the text (but keep different years)
        const yearRegex = new RegExp(`\\b${year}\\b`, 'g');
        product_name = product_name.replace(yearRegex, '').replace(/\s{2,}/g, ' ').trim();
        product_name = `${year} ${product_name}`.trim();
        
        // Remove all empty brackets ((), [], {}) possibly with spaces, and repeat until none left
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
    
    // Sanitize to only include allowed characters (same as Kamar)
    product_name = product_name.replace(/[^a-zA-Z0-9 \.%!&\)\(\-,/:_@#'\$?\+\t]/g, '').replace(/\s{2,}/g, ' ').trim();
    
    // Ensure length is within 1-100 characters
    if (product_name.length > 100) {
        product_name = product_name.substring(0, 100).trim();
    }
    if (product_name.length === 0) {
        product_name = "Unnamed Payable"; // Fallback for empty names
    }
    
    return product_name;
}

function parseCategoryFromLedger(ledger) {
    // Parse "21200 - Camp" -> "Camp"
    const parts = ledger.split('-');
    if (parts.length > 1) {
        return parts.slice(1).join('-').trim();
    }
    return ledger.trim();
}

function extractLedgerCode(ledger) {
    // Extract "21200" from "21200 - Camp"
    const match = ledger.match(/^(\d+)/);
    return match ? match[1] : '';
}

function matchStudentByNameAndRoom(lastName, firstName, room, yearLevel, seedRoll) {
    // Normalize room (remove "Room " prefix if present)
    const normalizedRoom = room.replace(/^Room\s*/i, '').trim();
    
    // Find all potential matches by first name and last name
    const nameMatches = seedRoll.filter(student => {
        const studentFirst = (student.first_names || '').toLowerCase().trim();
        const studentLast = (student.surname || '').toLowerCase().trim();
        const searchFirst = firstName.toLowerCase().trim();
        const searchLast = lastName.toLowerCase().trim();
        
        return studentFirst === searchFirst && studentLast === searchLast;
    });
    
    if (nameMatches.length === 0) {
        // Try fuzzy matching - find similar names
        const fuzzyMatches = findFuzzyMatches(firstName, lastName, room, yearLevel, seedRoll);
        return {
            matched: false,
            reason: 'Student not found on seed roll',
            potentialMatches: fuzzyMatches
        };
    }
    
    if (nameMatches.length === 1) {
        // Single match - verify room
        const student = nameMatches[0];
        const studentRoom = (student.class_name || '').replace(/^Room\s*/i, '').trim();
        
        if (studentRoom === normalizedRoom) {
            return {
                matched: true,
                studentId: student.student_id,
                needsReview: false
            };
        }
        
        // Room doesn't match - flag for review
        return {
            matched: false,
            needsReview: true,
            candidates: nameMatches,
            reason: `Name matches but room differs (Expected: ${normalizedRoom}, Found: ${studentRoom})`
        };
    }
    
    // Multiple matches - try to narrow down by year level
    const yearMatches = nameMatches.filter(student => {
        const studentYear = (student.year_level || '').toString().trim();
        return studentYear === yearLevel.toString().trim();
    });
    
    if (yearMatches.length === 1) {
        // Single match after year filter - verify room
        const student = yearMatches[0];
        const studentRoom = (student.class_name || '').replace(/^Room\s*/i, '').trim();
        
        if (studentRoom === normalizedRoom) {
            return {
                matched: true,
                studentId: student.student_id,
                needsReview: false
            };
        }
    }
    
    // Try exact room match
    const roomMatches = nameMatches.filter(student => {
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
    
    // Still multiple matches or no clear match - flag for review
    return {
        matched: false,
        needsReview: true,
        candidates: roomMatches.length > 0 ? roomMatches : nameMatches,
        reason: `Multiple matches found (${nameMatches.length} students with same name)`
    };
}

function findFuzzyMatches(firstName, lastName, room, yearLevel, seedRoll) {
    // Find students with similar names using Levenshtein distance
    const normalizedRoom = room.replace(/^Room\s*/i, '').trim();
    const matches = [];
    
    seedRoll.forEach(student => {
        const studentFirst = (student.first_names || '').toLowerCase().trim();
        const studentLast = (student.surname || '').toLowerCase().trim();
        const searchFirst = firstName.toLowerCase().trim();
        const searchLast = lastName.toLowerCase().trim();
        
        // Calculate similarity
        const firstSimilarity = calculateSimilarity(searchFirst, studentFirst);
        const lastSimilarity = calculateSimilarity(searchLast, studentLast);
        const avgSimilarity = (firstSimilarity + lastSimilarity) / 2;
        
        // Also check room and year level
        const studentRoom = (student.class_name || '').replace(/^Room\s*/i, '').trim();
        const studentYear = (student.year_level || '').toString().trim();
        const roomMatch = studentRoom === normalizedRoom;
        const yearMatch = studentYear === yearLevel.toString().trim();
        
        // Include if similarity is above 80%
        if (avgSimilarity >= 0.8) {
            matches.push({
                student,
                similarity: avgSimilarity,
                roomMatch,
                yearMatch,
                details: `${student.first_names} ${student.surname} (${student.class_name || 'No room'}, Year ${student.year_level || '?'}) - ${Math.round(avgSimilarity * 100)}% match`
            });
        }
    });
    
    // Sort by similarity (highest first)
    matches.sort((a, b) => b.similarity - a.similarity);
    
    // Return top 5 matches
    return matches.slice(0, 5);
}

function calculateSimilarity(str1, str2) {
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

function displayHeroResults() {
    const resultsSection = document.getElementById('resultsSectionHero');
    const statsContainer = document.getElementById('statsContainerHero');
    
    const payablesCount = heroProcessedData.payables.length;
    const pcatsCount = heroProcessedData.pcats.size;
    const outstandingsCount = heroProcessedData.outstandings.length;
    const removedCount = heroProcessedData.removed.length;
    const flaggedCount = heroFlaggedMatches.length;
    
    statsContainer.innerHTML = `
        <div class="info-box">
            <strong>Processing Complete!</strong>
            <ul>
                <li>Unique Payables: ${payablesCount} items</li>
                <li>Parent Categories: ${pcatsCount} unique</li>
                <li>Outstanding Charges: ${outstandingsCount} records</li>
                <li>Removed Transactions: ${removedCount}</li>
                ${flaggedCount > 0 ? `<li style="color: #e65100;">⚠ Flagged for Review: ${flaggedCount} students</li>` : ''}
            </ul>
        </div>
    `;
    
    // Enable download buttons
    document.getElementById('payablesBtnHero').disabled = false;
    document.getElementById('pcatsBtnHero').disabled = false;
    document.getElementById('outstandingsBtnHero').disabled = false;
    document.getElementById('removedBtnHero').disabled = false;
    
    // Display removed students with potential matches
    displayRemovedWithMatches();
    
    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

function displayRemovedWithMatches() {
    const removedWithMatches = heroProcessedData.removed.filter(r => 
        r.potentialMatches && r.potentialMatches !== 'None'
    );
    
    if (removedWithMatches.length === 0) return;
    
    const duplicatesContainer = document.getElementById('duplicatesContainerHero');
    
    let html = `
        <div class="card" style="border-color: #2196F3; background: #e3f2fd; margin-top: 16px;">
            <div class="card-header">
                <h3>ℹ Removed Students with Potential Matches (${removedWithMatches.length})</h3>
            </div>
            <p>The following students were removed but have similar names in the seed roll (80%+ match). This is for your information only and not included in the export.</p>
            <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 16px;">
    `;
    
    removedWithMatches.forEach((item, index) => {
        html += `
            <div style="padding: 12px; background: white; border: 1px solid #90caf9; border-radius: 4px;">
                <div>
                    <strong>${item.firstName} ${item.lastName}</strong> 
                    (Room: ${item.room}, Year: ${item.yearLevel}) - $${item.balance}
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
    
    // Append to duplicates container (after flagged matches if any)
    const existingContent = duplicatesContainer.innerHTML;
    duplicatesContainer.innerHTML = existingContent + html;
}

function displayFlaggedMatches() {
    const duplicatesContainer = document.getElementById('duplicatesContainerHero');
    
    let html = `
        <div class="card" style="border-color: #ff9800; background: #fff8f0;">
            <div class="card-header">
                <h3>⚠ Students Requiring Manual Review (${heroFlaggedMatches.length})</h3>
            </div>
            <p>The following students could not be automatically matched. Please select the correct student for each:</p>
            <div class="flagged-list" style="display: flex; flex-direction: column; gap: 16px; margin-top: 16px;">
    `;
    
    heroFlaggedMatches.forEach((item, index) => {
        const row = item.row;
        const reason = item.reason || 'Multiple matches found';
        html += `
            <div class="flagged-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: white; border: 1px solid #e1e8ed; border-radius: 4px;">
                <div class="flagged-info">
                    <strong>${row.firstName} ${row.lastName}</strong> 
                    (Room: ${row.room}, Year: ${row.yearLevel})
                    <br>
                    <small style="color: #666;">Transaction: ${row.lineItem} - $${row.balance}</small>
                    <br>
                    <small style="color: #ff9800;"><strong>Reason:</strong> ${reason}</small>
                </div>
                <div class="flagged-select" style="min-width: 300px;">
                    <select id="flaggedSelect${index}" class="flagged-dropdown" style="width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 14px;">
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
            <button id="applyFlaggedMatches" class="btn-primary" style="margin-top: 16px;">Apply Selections & Re-process</button>
        </div>
    `;
    
    duplicatesContainer.innerHTML = html;
    duplicatesContainer.style.display = 'block';
    
    // Add event listener for apply button
    document.getElementById('applyFlaggedMatches')?.addEventListener('click', applyFlaggedSelections);
}

function applyFlaggedSelections() {
    // TODO: Apply manual selections and re-process
    console.log('Applying flagged selections...');
    alert('Manual selection feature - select students and click Process Data again to include them.');
}

function downloadHeroFile(type) {
    let csvContent = '';
    let filename = '';
    const schoolName = document.getElementById('schoolNameInputHero')?.value || 'hero';
    const schoolSlug = schoolName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    
    switch(type) {
        case 'payables':
            csvContent = 'product_name,product_remarks2,product_gst_status,product_is_donation,product_ledgercode_or_remarks1,product_price_in_dollars,is_voluntary\n';
            csvContent += heroProcessedData.payables.map(p => 
                [p.product_name, p.product_remarks2, p.product_gst_status, p.product_is_donation, p.product_ledgercode_or_remarks1, p.product_price_in_dollars, p.is_voluntary].map(escapeCSV).join(',')
            ).join('\n');
            filename = `${schoolSlug}_payables.csv`;
            break;
            
        case 'pcats':
            csvContent = 'proto_payable_name,pcat\n';
            csvContent += Array.from(heroProcessedData.pcats).map(row => {
                const [name, cat] = row.split('\t');
                return [name, cat].map(escapeCSV).join(',');
            }).join('\n');
            filename = `${schoolSlug}_pcats.csv`;
            break;
            
        case 'outstandings':
            csvContent = 'student_id,payable_name,amount,caregiver_id\n';
            csvContent += heroProcessedData.outstandings.map(o => 
                [o.student_id, o.payable_name, o.amount, o.caregiver_id].map(escapeCSV).join(',')
            ).join('\n');
            filename = `${schoolSlug}_outstandings.csv`;
            break;
            
        case 'removed':
            csvContent = 'Last Name,First Name,Room,Year Level,Amount,Reason\n';
            csvContent += heroProcessedData.removed.map(r => 
                [r.lastName, r.firstName, r.room, r.yearLevel, r.balance, r.reason].map(escapeCSV).join(',')
            ).join('\n');
            filename = `${schoolSlug}_removed.csv`;
            break;
            
        default:
            console.error('Unknown file type:', type);
            return;
    }
    
    downloadCSV(csvContent, filename);
}

function escapeCSV(value) {
    if (value == null) return '';
    const str = String(value);
    // If the value contains comma, quote, or newline, wrap it in quotes and escape internal quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function downloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

function resetHeroApp() {
    heroRawData = [];
    heroSeedRoll = null;
    heroProcessedData = { payables: [], pcats: [], outstandings: [], removed: [] };
    heroFlaggedMatches = [];
    
    document.getElementById('csvInputHero').value = '';
    document.getElementById('fileNameHero').textContent = '';
    document.getElementById('seedRollPasteHero').value = '';
    document.getElementById('seedRollStatusHero').textContent = '';
    document.getElementById('excludeStudentsTextareaHero').value = '';
    document.getElementById('removeNamesTextareaHero').value = '';
    document.getElementById('resultsSectionHero').style.display = 'none';
    document.getElementById('duplicatesContainerHero').innerHTML = '';
    
    // Disable process and download buttons
    document.getElementById('processBtnHero').disabled = true;
    document.getElementById('payablesBtnHero').disabled = true;
    document.getElementById('pcatsBtnHero').disabled = true;
    document.getElementById('outstandingsBtnHero').disabled = true;
    document.getElementById('removedBtnHero').disabled = true;
    
    console.log('Hero app reset');
}
