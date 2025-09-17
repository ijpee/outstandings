// ============================================================================
// CSV GENERATION FUNCTIONS
// ============================================================================

// Add regex constant for product_name validation (based on user-provided pattern)
const PRODUCT_NAME_REGEX = /^[a-zA-Z0-9 \.%!&\)\(\-,/:_@#'\$?\+\t]{1,100}$/;

// Generate payable name from title and date added
function generatePayableName(title, dateAdded) {
    let year = "";
    if (dateAdded && typeof dateAdded === 'string') {
        // Try to extract year from date (support DD/MM/YYYY and YYYY-MM-DD)
        let match = dateAdded.match(/(\d{4})$/); // DD/MM/YYYY
        if (!match) match = dateAdded.match(/^(\d{4})/); // YYYY-MM-DD
        if (match) year = match[1];
    }
    let product_name = title || "";
    if (year) {
        // Remove year from anywhere in the title (whole word only)
        const yearRegex = new RegExp(`\\b${year}\\b`, 'g');
        product_name = product_name.replace(yearRegex, '').replace(/\s{2,}/g, ' ').trim();
        product_name = `${year} ${product_name}`.trim();
        // Remove all empty brackets ((), [], {}) possibly with spaces, and repeat until none left, after prepending year
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
    
    // Sanitize to only include allowed characters (remove invalids, including quotes)
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

// Generate payables CSV data from processedData
function generatePayablesCSV(data) {
    if (!Array.isArray(data) || data.length < 2) return [];
    // Headers for payables
    const headers = [
        "product_name",
        "product_remarks2",
        "product_gst_status",
        "product_is_donation",
        "product_ledgercode_or_remarks1",
        "product_price_in_dollars"
    ];
    // Find column indices in processed data
    const colIdx = {};
    data[0].forEach((h, i) => { colIdx[h] = i; });
    // Build rows and deduplicate by product_name
    const seen = new Set();
    const rows = [];
    for (const row of data.slice(1)) {
        // product_name: prepend year from Date_Added to Title_Cached
        const title = row[colIdx["Title_Cached"]] || "";
        const dateAdded = row[colIdx["Date_Added"]];
        const product_name = generatePayableName(title, dateAdded);
        if (seen.has(product_name)) continue;
        seen.add(product_name);
        // product_remarks2: always empty
        const product_remarks2 = "";
        // product_gst_status: "GST" if zc_Amount_Owing_GST is a number, else empty
        const gst_val = row[colIdx["zc_Amount_Owing_GST"]];
        const product_gst_status = (gst_val && !isNaN(Number(gst_val)) && String(gst_val).trim() !== "") ? "GST" : "GST exempt";
        // product_is_donation: TRUE if product_name contains "donation" or "contribution" (case-insensitive), else FALSE
        const nameLower = String(product_name).toLowerCase();
        const product_is_donation = (nameLower.includes("donation") || nameLower.includes("contribution")) ? "TRUE" : "FALSE";
        // product_ledgercode_or_remarks1: from Account_Cached, add ~LDC_ in front
        const ledger = row[colIdx["Account_Cached"]] || "";
        let product_ledgercode_or_remarks1 = ledger ? `~LDC_${ledger}` : "";
        // Remove anything after the first forward slash (if present)
        if (product_ledgercode_or_remarks1.includes("/")) {
        product_ledgercode_or_remarks1 = product_ledgercode_or_remarks1.split("/")[0];
        }
        // product_price_in_dollars: from zc_Amount_Total
        const product_price_in_dollars = row[colIdx["zc_Amount_Total"]] || "";
        rows.push([
            product_name,
            product_remarks2,
            product_gst_status,
            product_is_donation,
            product_ledgercode_or_remarks1,
            product_price_in_dollars
        ]);
    }
    return [headers, ...rows];
}

// Generate pcats CSV data from processedData
function generatePcatsCSV(data) {
    if (!Array.isArray(data) || data.length < 2) return [];
    const headers = ["proto_payable_name", "pcat"];
    const colIdx = {};
    data[0].forEach((h, i) => { colIdx[h] = i; });
    const seen = new Set();
    const rows = [];
    for (const row of data.slice(1)) {
        const proto_payable_name = row[colIdx["payable_name"]] || "";
        const pcat = row[colIdx["Department_Cached"]] || "";
        const key = proto_payable_name + "||" + pcat;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push([proto_payable_name, pcat]);
    }
    return [headers, ...rows];
}

// Generate outstandings CSV data from processedData
function generateOutstandingsCSV(data, moe) {
    if (!Array.isArray(data) || data.length < 2) return [];
    const headers = ["student_id", "payable_name", "amount", "caregiver_id"];
    const colIdx = {};
    data[0].forEach((h, i) => { colIdx[h] = i; });
    const rows = data.slice(1).map(row => {
        let studentId = row[colIdx["student_id"]] || "";
        if (moe && moe.length === 4 && /^\d{4}$/.test(moe) && !studentId.includes('.')) {
            studentId = studentId ? studentId + '.' + moe : '';
        }
        return [
            studentId,
            row[colIdx["payable_name"]] || "",
            row[colIdx["zc_Amount_Owing"]] || "",
            ""
        ];
    });
    return [headers, ...rows];
}

// ============================================================================
// DOWNLOAD FUNCTIONS
// ============================================================================
// Helper to get school name (for filenames)
function getSchoolNameSlug() {
    const input = document.getElementById('schoolNameInput');
    if (!input) return '';
    const val = (input.value || '').trim();
    if (!val) return '';
    // Slugify: lowercase, replace spaces with _, remove non-alphanum/underscore
    return val.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function downloadRawCSV() {
    if (!csvData || csvData.length < 2) {
        showStatus('No raw data to download.', 'error');
        return;
    }
    const csvContent = convertToCSV(csvData);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const schoolSlug = getSchoolNameSlug();
    const filename = (schoolSlug ? schoolSlug + '_' : '') + 'raw_with_headers.csv';
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus('Raw CSV file (with headers) downloaded successfully.', 'success');
}

function downloadProcessedCSV() {
    if (!processedData || processedData.length < 2) {
        showStatus('No processed data to download.', 'error');
        return;
    }
    const csvContent = convertToCSV(processedData);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const schoolSlug = getSchoolNameSlug();
    const filename = (schoolSlug ? schoolSlug + '_' : '') + 'processed_data.csv';
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus('Processed data file downloaded successfully.', 'success');
}

function downloadPayablesCSV() {
    if (!processedData || processedData.length < 2) {
        showStatus('No processed data to download as payables.', 'error');
        return;
    }
    const payablesData = generatePayablesCSV(processedData);
    const csvContent = convertToCSV(payablesData);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const schoolSlug = getSchoolNameSlug();
    const filename = (schoolSlug ? schoolSlug + '_' : '') + 'payables.csv';
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus('Payables file downloaded successfully.', 'success');
}
// Reset functionality
const resetBtn = document.getElementById('resetBtn');
if (resetBtn) {
    resetBtn.addEventListener('click', resetAll);
    // Add line breaks after the reset button
    const br1 = document.createElement('br');
    const br2 = document.createElement('br');
    if (resetBtn.parentNode) resetBtn.parentNode.insertBefore(br1, resetBtn.nextSibling);
    if (resetBtn.parentNode) resetBtn.parentNode.insertBefore(br2, resetBtn.nextSibling);
}

function resetAll() {
    // Reset file input
    if (csvInput) csvInput.value = '';
    if (csvInput) csvInput.style.display = '';
    const label = document.querySelector('label[for="csvInput"]');
    if (label) label.style.display = '';
    if (fileName) fileName.textContent = '';
    if (processBtn) processBtn.disabled = true;
    clearOutput();
    csvData = [];
    processedData = [];
    removedStudents = []; // Reset removed students tracking
    seedRollData = []; // Reset seed roll data
    // Reset school name and MOE inputs
    const schoolNameInput = document.getElementById('schoolNameInput');
    const moeInput = document.getElementById('moeInput');
    if (schoolNameInput) schoolNameInput.value = '';
    if (moeInput) moeInput.value = '';
    // Reset seed roll paste input
    if (seedRollPaste) seedRollPaste.value = '';
    if (seedRollPasteStatus) seedRollPasteStatus.textContent = '';
    // Hide raw button on reset
    if (rawBtn) rawBtn.style.display = 'none';
    toggleDownloadButtons(false);
    // Hide and clear filter elements
    if (applyFilterBtn) applyFilterBtn.style.display = 'none';
    if (removeNamesTextarea) {
        removeNamesTextarea.style.display = 'none';
        removeNamesTextarea.value = '';
    }
}
// Global variables
let csvData = [];
let processedData = [];
let processingStats = {};
let removedStudents = []; // Track removed students for verification
let seedRollData = []; // Store parsed seed roll student IDs

// DOM elements
const csvInput = document.getElementById('csvInput');
const fileName = document.getElementById('fileName');
const processBtn = document.getElementById('processBtn');
const status = document.getElementById('status');
const preview = document.getElementById('preview');
// Seed roll paste-only elements (UI simplified)
const seedRollPaste = document.getElementById('seedRollPaste');
const loadSeedRollPaste = document.getElementById('loadSeedRollPaste');
const seedRollPasteStatus = document.getElementById('seedRollPasteStatus');
// Event listeners
if (csvInput) {
    csvInput.addEventListener('change', handleFileSelect);
}
if (processBtn) {
    processBtn.addEventListener('click', processCSV);
}
if (loadSeedRollPaste) {
    loadSeedRollPaste.addEventListener('click', handleSeedRollPasteLoad);
}

// Add text area and button for payable names to remove (after processBtn)
let removeNamesTextarea = document.getElementById('removeNamesTextarea');
if (!removeNamesTextarea && processBtn) {
    removeNamesTextarea = document.createElement('textarea');
    removeNamesTextarea.id = 'removeNamesTextarea';
    removeNamesTextarea.placeholder = 'Enter payable names to remove (one per line, e.g., "2023 Example Title")';
    removeNamesTextarea.rows = 5;
    removeNamesTextarea.style.width = '100%';
    removeNamesTextarea.style.marginTop = '10px';
    removeNamesTextarea.style.display = 'none';  // Hide initially
    if (processBtn.parentNode) processBtn.parentNode.insertBefore(removeNamesTextarea, processBtn.nextSibling);
}

let applyFilterBtn = document.getElementById('applyFilterBtn');
if (!applyFilterBtn && removeNamesTextarea) {
    applyFilterBtn = document.createElement('button');
    applyFilterBtn.id = 'applyFilterBtn';
    applyFilterBtn.textContent = 'Apply Filter & Remove Rows';
    applyFilterBtn.style.display = 'none';
    applyFilterBtn.style.marginTop = '5px';
    if (removeNamesTextarea.parentNode) removeNamesTextarea.parentNode.insertBefore(applyFilterBtn, removeNamesTextarea.nextSibling);
}
if (applyFilterBtn) {
    applyFilterBtn.addEventListener('click', () => {
        if (!removeNamesTextarea) return;
        const namesToRemove = removeNamesTextarea.value.split('\n').map(name => name.trim()).filter(name => name);
        if (namesToRemove.length > 0 && processedData.length > 1) {
            processedData = filterByPayableNames(processedData, namesToRemove);
            displayPreview(processedData);
            showStatus('Rows filtered successfully.', 'success');
        } else {
            showStatus('No names entered or no data to filter.', 'error');
        }
    });
}

// Add button for downloading raw CSV (with headers, no processing)
let rawBtn = document.getElementById('rawBtn');
if (!rawBtn) {
    rawBtn = document.createElement('button');
    rawBtn.id = 'rawBtn';
    rawBtn.textContent = 'Download Raw CSV (with headers)';
    rawBtn.className = 'download-btn';
    rawBtn.style.display = 'none';
    const outputSection = document.querySelector('.output-section');
    if (outputSection) {
        outputSection.appendChild(rawBtn);
    }
}
if (rawBtn) {
    rawBtn.addEventListener('click', downloadRawCSV);
}

// Add button for downloading processed data CSV
let processedBtn = document.getElementById('processedBtn');
if (!processedBtn) {
    processedBtn = document.createElement('button');
    processedBtn.id = 'processedBtn';
    processedBtn.textContent = 'Download Processed Data CSV';
    processedBtn.className = 'download-btn';
    processedBtn.style.display = 'none';
    const outputSection = document.querySelector('.output-section');
    if (outputSection) {
        outputSection.appendChild(processedBtn);
    }
}
if (processedBtn) {
    processedBtn.addEventListener('click', downloadProcessedCSV);
}

// Add button for downloading removed students CSV
let removedBtn = document.getElementById('removedBtn');
if (!removedBtn) {
    removedBtn = document.createElement('button');
    removedBtn.id = 'removedBtn';
    removedBtn.textContent = 'Download Removed Students CSV';
    removedBtn.className = 'download-btn';
    removedBtn.style.display = 'none';
    const outputSection = document.querySelector('.output-section');
    if (outputSection) {
        outputSection.appendChild(removedBtn);
    }
}
if (removedBtn) {
    removedBtn.style.backgroundColor = 'lightcoral';
    removedBtn.addEventListener('click', downloadRemovedStudentsCSV);
}

// Add a line break to separate the groups
const outputSection = document.querySelector('.output-section');
if (outputSection) {
    const br = document.createElement('br');
    outputSection.appendChild(br);
    const br2 = document.createElement('br');
    outputSection.appendChild(br2);
}

// Add buttons for downloading payables, pcats, and outstandings CSV (in specified order, on separate line)
let payablesBtn = document.getElementById('payablesBtn');
if (!payablesBtn) {
    payablesBtn = document.createElement('button');
    payablesBtn.id = 'payablesBtn';
    payablesBtn.textContent = 'Download Payables CSV';
    payablesBtn.className = 'download-btn';
    payablesBtn.style.display = 'none';
    const outputSection = document.querySelector('.output-section');
    if (outputSection) {
        outputSection.appendChild(payablesBtn);
    }
}
if (payablesBtn) {
    payablesBtn.style.backgroundColor = 'lightgreen';
    payablesBtn.addEventListener('click', downloadPayablesCSV);
}

let pcatsBtn = document.getElementById('pcatsBtn');
if (!pcatsBtn) {
    pcatsBtn = document.createElement('button');
    pcatsBtn.id = 'pcatsBtn';
    pcatsBtn.textContent = 'Download Pcats CSV';
    pcatsBtn.className = 'download-btn';
    pcatsBtn.style.display = 'none';
    const outputSection = document.querySelector('.output-section');
    if (outputSection) {
        outputSection.appendChild(pcatsBtn);
    }
}
if (pcatsBtn) {
    pcatsBtn.style.backgroundColor = 'lightgreen';
    pcatsBtn.addEventListener('click', downloadPcatsCSV);
}

let outstandingsBtn = document.getElementById('outstandingsBtn');
let moeInput = document.getElementById('moeInput');
// No need to create moeInput, it's now in HTML
if (!outstandingsBtn) {
    outstandingsBtn = document.createElement('button');
    outstandingsBtn.id = 'outstandingsBtn';
    outstandingsBtn.textContent = 'Download Outstandings CSV';
    outstandingsBtn.className = 'download-btn';
    outstandingsBtn.style.display = 'none';
    const outputSection = document.querySelector('.output-section');
    if (outputSection) {
        outputSection.appendChild(outstandingsBtn);
    }
}
if (outstandingsBtn) {
    outstandingsBtn.style.backgroundColor = 'lightgreen';
    outstandingsBtn.addEventListener('click', downloadOutstandingsCSV);
}

// Show or hide download buttons based on data availability
function toggleDownloadButtons(show) {
    const display = show ? 'inline-block' : 'none';
    if (processedBtn) processedBtn.style.display = display;
    if (payablesBtn) payablesBtn.style.display = display;
    if (pcatsBtn) pcatsBtn.style.display = display;
    if (outstandingsBtn) outstandingsBtn.style.display = display;
    if (removedBtn) {
        // Always show removed students button when showing other buttons
        // The download function will handle the case when there are no removed students
        removedBtn.style.display = display;
    }
}

// ============================================================================
// DATA PROCESSING FUNCTIONS
// ============================================================================

// Download outstandings CSV
function downloadOutstandingsCSV() {
    if (!processedData || processedData.length < 2) {
        showStatus('No processed data to download as outstandings.', 'error');
        return;
    }
    const moe = moeInput ? moeInput.value.trim() : '';
    if (moe && !/^\d{4}$/.test(moe)) {
        showStatus('MOE must be a 4 digit number.', 'error');
        moeInput.focus();
        return;
    }
    const outstandingsData = generateOutstandingsCSV(processedData, moe);
    const csvContent = convertToCSV(outstandingsData);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const schoolSlug = getSchoolNameSlug();
    const filename = (schoolSlug ? schoolSlug + '_' : '') + 'outstandings.csv';
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus('Outstandings file downloaded successfully.', 'success');
}

// Download removed students CSV for verification
function downloadRemovedStudentsCSV() {
    if (!removedStudents || removedStudents.length === 0) {
        alert('No students were removed.');
        return;
    }
    
    // Create CSV data for removed students
    const headers = ['student_id', 'payer_name', 'tutor', 'title', 'amount_owing', 'payable_name', 'removal_reason'];
    const rows = removedStudents.map(student => [
        student.student_id,
        student.payer_name,
        student.tutor,
        student.title,
        student.amount_owing,
        student.payable_name || '',
        student.reason
    ]);
    
    const removedData = [headers, ...rows];
    const csvContent = convertToCSV(removedData);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const schoolSlug = getSchoolNameSlug();
    const filename = (schoolSlug ? schoolSlug + '_' : '') + 'removed_students.csv';
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showStatus('Removed students verification file downloaded successfully.', 'success');
}

// (Seed coverage export removed for simplicity)

// ============================================================================
// FILE HANDLING FUNCTIONS
// ============================================================================

// Download pcats CSV
function downloadPcatsCSV() {
    if (!processedData || processedData.length < 2) {
        showStatus('No processed data to download as pcats.', 'error');
        return;
    }
    const pcatsData = generatePcatsCSV(processedData);
    const csvContent = convertToCSV(pcatsData);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const schoolSlug = getSchoolNameSlug();
    const filename = (schoolSlug ? schoolSlug + '_' : '') + 'pcats.csv';
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus('Pcats file downloaded', 'success');
}

// Handle file selection
function handleFileSelect(event) {
    const files = Array.from(event.target.files).filter(f => f.name.toLowerCase().endsWith('.csv'));
    if (files.length === 0) {
        showStatus('Please select at least one valid CSV file.', 'error');
        if (fileName) fileName.textContent = '';
        if (processBtn) processBtn.disabled = true;
        return;
    }
    if (fileName) fileName.textContent = files.map(f => f.name).join(', ');
    if (processBtn) processBtn.disabled = false;
    clearOutput();
    if (csvInput) csvInput.style.display = 'none';
    const label = document.querySelector('label[for="csvInput"]');
    if (label) label.style.display = 'none';

    let loaded = 0;
    let allRows = [];
    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const rows = parseCSV(e.target.result);
            if (rows.length > 0) {
                allRows = allRows.concat(rows);
            }
            loaded++;
            if (loaded === files.length) {
                // Add header row at the top (since files have no headers)
                const allHeaders = [
                    "student_id",
                    "Payer_Name_Cached",
                    "zc_Level_LiveGrid",
                    "zc_Tutor_LiveGrid",
                    "House_Cached",
                    "zc_LeftDate",
                    "zc_Title_Overide",
                    "Title_Cached",
                    "Date_Added",
                    "zc_Amount_Total",
                    "zc_Amount_GST",
                    "zc_Amount_Owing",
                    "zc_Amount_Owing_GST",
                    "Payment_Date",
                    "Amount_Paid",
                    "RollOver_Student",
                    "Payers__thisCharged::zc_Pays_DD_or_AP",
                    "Account_Cached",
                    "Department_Cached",
                    "Notes"
                ];
                csvData = [allHeaders, ...allRows];
                
                // Show raw download button immediately after headers are added
                if (rawBtn) rawBtn.style.display = 'inline-block';
            }
        };
        reader.readAsText(file);
    });
}

// (File/URL seed roll loaders removed; paste-only flow remains)

// Handle seed roll pasted text loading
function handleSeedRollPasteLoad() {
    const text = (seedRollPaste && seedRollPaste.value) ? seedRollPaste.value.trim() : '';
    if (!text) {
        showStatus('Please paste the seed roll text first.', 'error');
        return;
    }
    // Clear any previous state

    // Parse
    seedRollData = parseSeedRoll(text);
    if (seedRollPasteStatus) seedRollPasteStatus.textContent = `Loaded from pasted text: ${seedRollData.length} students`;
    showStatus(`Seed roll loaded from pasted text with ${seedRollData.length} student IDs.`, 'success');
}

// Parse seed roll text (tab or comma separated, extract student IDs from "student" rows)
function parseSeedRoll(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const seen = new Set();
    const ids = [];
    lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return; // Skip empty lines

        // Prefer tab separation; if no tab present, fall back to comma
        let columns = trimmedLine.split('\t');
        if (columns.length === 1) {
            columns = trimmedLine.split(',');
        }

        const tag = (columns[0] || '').trim().toLowerCase();
        if (tag === 'student' && columns[1]) {
            const id = (columns[1] || '').trim();
            if (id && id.includes('.')) {
                if (!seen.has(id)) {
                    seen.add(id);
                    ids.push(id);
                }
                console.log(`✓ Parsed student ID from line ${index + 1}: "${id}"`);
            } else {
                console.log(`⚠ Invalid student ID format in line ${index + 1}: "${id}"`);
            }
        } else if (tag === 'caregiver') {
            // ignore caregiver lines
        }
    });
    console.log(`📊 Total parsed seed roll IDs: ${ids.length}`, ids);
    return ids;
}

// Parse CSV content (handles quoted fields and commas inside quotes)
function parseCSV(csvText) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    let i = 0;
    const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    while (i < text.length) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                row.push(cell);
                cell = '';
            } else if (char === '\n') {
                row.push(cell);
                rows.push(row);
                row = [];
                cell = '';
            } else {
                cell += char;
            }
        }
        i++;
    }
    // Add last cell/row if not empty
    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}

// Process the CSV data (this is where you'll add your specific formatting logic)
function processCSV() {
    if (!csvData || csvData.length === 0) {
        showStatus('No data to process.', 'error');
        return;
    }

    showStatus('Processing...', '');

    // Step 1: Clean data
    let cleanedData = transformData(csvData);

    // Step 2: Add payable_name column to each row
    processedData = addPayableNameColumn(cleanedData);

    showStatus('File processed successfully.', 'success');
    displayPreview(processedData);
    toggleDownloadButtons(true);
    if (applyFilterBtn) applyFilterBtn.style.display = 'inline-block';  // Show filter button
    if (removeNamesTextarea) removeNamesTextarea.style.display = 'block';  // Show text area
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Add payable_name column to each row using a single source of truth
function addPayableNameColumn(data) {
    if (!Array.isArray(data) || data.length < 2) return data;
    const headers = [...data[0], "payable_name"];
    const colIdx = {};
    data[0].forEach((h, i) => colIdx[h] = i);
    const rows = data.slice(1).map(row => {
        const title = row[colIdx["Title_Cached"]];
        const dateAdded = row[colIdx["Date_Added"]];
        const payableName = generatePayableName(title, dateAdded);
        return [...row, payableName];
    });
    return [headers, ...rows];
}

// New function to calculate current processing stats from data
function calculateProcessingStats(data) {
    const finalCount = data.length > 1 ? data.length - 1 : 0;
    const filteredCount = removedStudents.filter(student => student.reason === 'Filtered by payable name').length;
    return {
        finalCount: finalCount,
        filteredCount: filteredCount
    };
}

// New function to filter processedData by payable names
function filterByPayableNames(data, namesToRemove) {
    if (!Array.isArray(data) || data.length < 2) return data;
    const headers = data[0];
    const colIdx = {};
    headers.forEach((h, i) => colIdx[h] = i);
    const payableNameIdx = colIdx["payable_name"];
    if (payableNameIdx === undefined) return data;  // No payable_name column
    const rows = data.slice(1).filter(row => {
        const payableName = row[payableNameIdx] || '';
        if (namesToRemove.includes(payableName)) {
            // Track removed row for verification
            removedStudents.push({
                student_id: row[colIdx["student_id"]] || '',
                payer_name: row[colIdx["Payer_Name_Cached"]] || '',
                tutor: row[colIdx["zc_Tutor_LiveGrid"]] || '',
                title: row[colIdx["Title_Cached"]] || '',
                amount_owing: row[colIdx["zc_Amount_Owing"]] || '',
                payable_name: payableName,
                reason: 'Filtered by payable name'
            });
            return false;
        }
        return true;
    });
    return [headers, ...rows];
}

// Convert array to CSV format
function convertToCSV(data) {
    return data.map(row => {
        return row.map(cell => {
            const escaped = String(cell).replace(/"/g, '""');
            return escaped.includes(',') || escaped.includes('"') || escaped.includes('\n') 
                ? `"${escaped}"` 
                : escaped;
        }).join(',');
    }).join('\n');
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// UI FUNCTIONS
// ============================================================================

// Display preview of processed data
function transformData(data) {
    if (data.length === 0) return data;
    
    // Initialize stats - restored staff/pre-enrol counters for safe automation
    processingStats = {
        originalCount: 0,
        removedZeroOwing: 0,
        removedPastLeftDate: 0,
        removedStaff: 0,
        removedPreEnrol: 0,
    removedInvalidId: 0,
    removedSeedRoll: 0,
        finalCount: 0
    };
    
    // Reset removed students tracking
    removedStudents = [];
    
    // Always use the specified headers
    // Define all headers and the ones to remove
    const allHeaders = [
        "student_id",
        "Payer_Name_Cached",
        "zc_Level_LiveGrid",
        "zc_Tutor_LiveGrid",
        "House_Cached",
        "zc_LeftDate",
        "zc_Title_Overide",
        "Title_Cached",
        "Date_Added",
        "zc_Amount_Total",
        "zc_Amount_GST",
        "zc_Amount_Owing",
        "zc_Amount_Owing_GST",
        "Payment_Date",
        "Amount_Paid",
        "RollOver_Student",
        "Payers__thisCharged::zc_Pays_DD_or_AP",
        "Account_Cached",
        "Department_Cached",
        "Notes"
    ];
    const removeCols = [
        "Notes",
        "Payment_Date",
        "Amount_Paid",
        "RollOver_Student",
        "Payers__thisCharged::zc_Pays_DD_or_AP",
        "zc_Amount_GST",
        "zc_Level_LiveGrid",
        "House_Cached"
    ];
    // Compute indices to keep
    const keepIndices = allHeaders
        .map((h, i) => removeCols.includes(h) ? null : i)
        .filter(i => i !== null);
    // Build new headers and rows
    const newHeaders = keepIndices.map(i => allHeaders[i]);
    const rows = data.slice(1);
    
    // Track original count
    processingStats.originalCount = rows.length;
    
    // Find the index of zc_Amount_Owing and zc_LeftDate in the kept columns
    const zcAmountOwingIdx = newHeaders.indexOf("zc_Amount_Owing");
    const zcLeftDateIdx = newHeaders.indexOf("zc_LeftDate");
    const tutorIdx = newHeaders.indexOf("zc_Tutor_LiveGrid");
    const studentIdIdx = newHeaders.indexOf("student_id");
    // Only keep rows where zc_Amount_Owing is not blank/0 and zc_LeftDate is blank, invalid, or a future date
    const today = new Date();
    today.setHours(0,0,0,0); // Ignore time for comparison
    function parseDMY(dateStr) {
        // Parse DD/MM/YYYY to Date
        if (!dateStr || typeof dateStr !== 'string') return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return null;
        const [dd, mm, yyyy] = parts;
        const d = new Date(`${yyyy}-${mm}-${dd}`);
        if (isNaN(d.getTime())) return null;
        d.setHours(0,0,0,0);
        return d;
    }
    let newRows = rows
        .map(row => keepIndices.map(i => row[i]))
        .filter(row => {
            // FIRST: Check owing amount - this trumps everything else
            const val = row[zcAmountOwingIdx];
            const owingOk = val && String(val).trim() !== '' && String(Number(val).toFixed(2)) !== '0.00';
            if (!owingOk) {
                processingStats.removedZeroOwing++;
                return false;
            }
            
            // SECOND: Check left date - also trumps staff detection
            const leftDateStr = row[zcLeftDateIdx];
            if (leftDateStr && String(leftDateStr).trim() !== '') {
                // Try to parse DD/MM/YYYY
                const leftDate = parseDMY(leftDateStr);
                if (leftDate && leftDate <= today) {
                    processingStats.removedPastLeftDate++;
                    return false;
                }
            }
            
            // THIRD: Only then check for staff/pre-enrollment patterns
            const studentId = row[studentIdIdx] || '';
            const tutor = (row[tutorIdx] || '').toLowerCase();
            
            // 1. Check tutor field for staff indicators
            if (tutor.includes('staff') || tutor.includes('admin') || 
                tutor.includes('teacher') || tutor.includes('employee')) {
                
                // Track removed student for verification
                removedStudents.push({
                    student_id: studentId,
                    payer_name: row[newHeaders.indexOf("Payer_Name_Cached")] || '',
                    tutor: row[tutorIdx] || '',
                    title: row[newHeaders.indexOf("Title_Cached")] || '',
                    amount_owing: row[zcAmountOwingIdx] || '',
                    reason: 'Staff/Admin'
                });
                
                processingStats.removedStaff++;
                return false;
            }
            
            // 2. Safe pre-enrollment detection in tutor field
            if (tutor.includes('pre-enrol') || tutor.includes('preenrol') ||
                (tutor.includes('enrol') && !tutor.includes('enrollment'))) {
                
                // Track removed student for verification
                removedStudents.push({
                    student_id: studentId,
                    payer_name: row[newHeaders.indexOf("Payer_Name_Cached")] || '',
                    tutor: row[tutorIdx] || '',
                    title: row[newHeaders.indexOf("Title_Cached")] || '',
                    amount_owing: row[zcAmountOwingIdx] || '',
                    reason: 'Pre-enrollment'
                });
                
                processingStats.removedPreEnrol++;
                return false;
            }
            
        // 3. Invalid student IDs (final check)
        // Accept either numeric-only (no MOE yet) OR numeric.MOE (where MOE is exactly 4 digits)
        const idStr = studentId != null ? studentId.toString().trim() : '';
        const validId = /^\d+$/.test(idStr) || /^\d+\.\d{4}$/.test(idStr);
        if (idStr && !validId) {
                // Track removed student for verification
                removedStudents.push({
                    student_id: idStr,
                    payer_name: row[newHeaders.indexOf("Payer_Name_Cached")] || '',
                    tutor: row[tutorIdx] || '',
                    title: row[newHeaders.indexOf("Title_Cached")] || '',
                    amount_owing: row[zcAmountOwingIdx] || '',
                    reason: 'Invalid Student ID'
                });
                
                processingStats.removedInvalidId++;
                return false;
            }
            
            // If we get here, keep the student
            return true;
        });
    
    // Track final count after initial filtering
    processingStats.finalCount = newRows.length;
    
    // Append MOE to student_id for matching and output
    const moe = moeInput ? moeInput.value.trim() : '';
    if (moe && /^\d{4}$/.test(moe)) {
        console.log('Appending MOE', moe, 'to student IDs');
        newRows.forEach(row => {
            const studentIdIdx = newHeaders.indexOf("student_id");
            if (row[studentIdIdx] && !row[studentIdIdx].includes('.')) {
                const originalId = row[studentIdIdx];
                row[studentIdIdx] = row[studentIdIdx] + '.' + moe;
                console.log('Appended MOE:', originalId, '->', row[studentIdIdx]);
            } else {
                console.log('Student ID already has MOE or is empty:', row[studentIdIdx]);
            }
        });
    } else {
        console.log('No MOE to append or invalid MOE:', moe);
    }
    
    // Apply seed roll filtering if seed roll is loaded
    if (seedRollData.length > 0) {
        console.log('SEED ROLL FILTERING: Starting with', newRows.length, 'rows and', seedRollData.length, 'seed roll IDs');
        console.log('First few seed roll IDs:', seedRollData.slice(0, 5));
        console.log('First few student IDs to check:', newRows.slice(0, 5).map(row => row[newHeaders.indexOf("student_id")]));
        // Use a Set for O(1) lookups and normalized IDs
        const seedSet = new Set(seedRollData.map(id => (id || '').trim()));
        const filteredRows = [];
        const removedForSeed = [];
        newRows.forEach(row => {
            const studentIdIdx = newHeaders.indexOf("student_id");
            const studentId = (row[studentIdIdx] || '').trim();
            if (seedSet.has(studentId)) {
                filteredRows.push(row);
            } else {
                removedForSeed.push({
                    student_id: studentId,
                    payer_name: row[newHeaders.indexOf("Payer_Name_Cached")] || '',
                    tutor: row[newHeaders.indexOf("zc_Tutor_LiveGrid")] || '',
                    title: row[newHeaders.indexOf("Title_Cached")] || '',
                    amount_owing: row[newHeaders.indexOf("zc_Amount_Owing")] || '',
                    reason: 'Not in current seed roll'
                });
            }
        });
        console.log('SEED ROLL FILTERING: After filtering - kept:', filteredRows.length, 'removed:', removedForSeed.length);
        newRows = filteredRows;
        removedStudents.push(...removedForSeed);
        processingStats.removedSeedRoll = removedForSeed.length;
        processingStats.finalCount = newRows.length;
        console.log('SEED ROLL FILTERING: Updated stats - removedSeedRoll:', processingStats.removedSeedRoll);

    } else {
        console.log('SEED ROLL FILTERING: No seed roll data loaded, skipping filtering');
    }
    
    return [newHeaders, ...newRows];
}

// Display preview of processed data
function displayPreview(data) {
    if (!preview) return;
    if (data.length === 0) {
        preview.innerHTML = '<p>No data to preview.</p>';
        return;
    }
    let html = '<table style="width:100%">';
    // Headers
    html += '<thead><tr>';
    data[0].forEach(header => {
        html += `<th>${escapeHtml(header)}</th>`;
    });
    html += '</tr></thead>';
    // Data rows (show first 10 rows for preview)
    html += '<tbody>';
    const previewRows = data.slice(1, 11);
    previewRows.forEach(row => {
        html += '<tr>';
        for (let i = 0; i < data[0].length; i++) {
            html += `<td>${escapeHtml(row[i] || '')}</td>`;
        }
        html += '</tr>';
    });
    html += '</tbody>';
    if (data.length > 11) {
        html += `<tfoot><tr><td colspan="${data[0].length}"><em>Showing first 10 rows of ${data.length - 1} total rows</em></td></tr></tfoot>`;
    }
    html += '</table>';
    
    // Add processing statistics - calculate from current data
    const currentStats = calculateProcessingStats(data);
    html += '<div style="margin-top: 15px; padding: 10px; background-color: #f5f5f5; border-radius: 4px;">';
    html += '<strong>Processing Statistics:</strong><br>';
    html += `Original student records: ${processingStats.originalCount}<br>`;
    if (processingStats.removedStaff > 0) {
        html += `Students removed (staff/admin): ${processingStats.removedStaff}<br>`;
    }
    if (processingStats.removedPreEnrol > 0) {
        html += `Students removed (pre-enrollments): ${processingStats.removedPreEnrol}<br>`;
    }
    if (processingStats.removedZeroOwing > 0) {
        html += `Students removed (zero/blank owing amount): ${processingStats.removedZeroOwing}<br>`;
    }
    if (processingStats.removedPastLeftDate > 0) {
        html += `Students removed (past left date): ${processingStats.removedPastLeftDate}<br>`;
    }
    if (processingStats.removedInvalidId > 0) {
        html += `Students removed (invalid student ID): ${processingStats.removedInvalidId}<br>`;
    }
    if (processingStats.removedSeedRoll > 0) {
        html += `Students removed (not in seed roll): ${processingStats.removedSeedRoll}<br>`;
    }
    if (currentStats.filteredCount > 0) {
        html += `Students removed (filtered by payable name): ${currentStats.filteredCount}<br>`;
    }
    html += `<strong>Final student records: ${currentStats.finalCount}</strong>`;
    html += '</div>';
    
    if (preview) preview.innerHTML = html;
}

// Show status message
function showStatus(message, type) {
    if (!status) return;
    if (status) status.textContent = message;
    if (status) status.className = `status ${type}`;
}

// Clear output
function clearOutput() {
    if (status) status.textContent = '';
    if (status) status.className = 'status';
    if (preview) preview.innerHTML = '';
    toggleDownloadButtons(false);
}

// ============================================================================
// INITIALIZATION AND EVENT LISTENERS
// ============================================================================

// Make label act as button for file input
const label = document.querySelector('label[for="csvInput"]');
if (label) {
    label.addEventListener('click', function(e) {
        e.preventDefault();
        csvInput.click();
    });
}

// ============================================================================
// HELP SYSTEM
// ============================================================================

// Help system event listeners
const helpBtn = document.getElementById('helpBtn');
const backBtn = document.getElementById('backBtn');
const mainContent = document.getElementById('mainContent');
const helpContent = document.getElementById('helpContent');

if (helpBtn) {
    helpBtn.addEventListener('click', showHelp);
}

if (backBtn) {
    backBtn.addEventListener('click', showMain);
}

function showHelp() {
    mainContent.style.display = 'none';
    helpContent.style.display = 'block';
}

function showMain() {
    helpContent.style.display = 'none';
    mainContent.style.display = 'block';
}
