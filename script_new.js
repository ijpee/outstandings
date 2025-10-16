// ============================================================================
// APPLICATION STATE
// ============================================================================

const state = {
    csv: {
        raw: [],
        processed: [],
        removed: []
    },
    seedRoll: {
        ids: [],
        idMap: {}
    },
    exclude: {
        ids: []
    },
    config: {
        schoolName: '',
        moeFallback: ''
    },
    stats: {
        original: 0,
        removed: {
            zeroOwing: 0,
            pastLeftDate: 0,
            staff: 0,
            preEnrol: 0,
            invalidId: 0,
            seedRoll: 0,
            excluded: 0,
            filtered: 0
        },
        final: 0
    }
};

// ============================================================================
// CSV PARSER
// ============================================================================

const CSVParser = {
    parse(csvText) {
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
        
        if (cell.length > 0 || row.length > 0) {
            row.push(cell);
            rows.push(row);
        }
        
        return rows;
    },

    toCSV(data) {
        return data.map(row => {
            return row.map(cell => {
                const escaped = String(cell).replace(/"/g, '""');
                return escaped.includes(',') || escaped.includes('"') || escaped.includes('\n') 
                    ? `"${escaped}"` 
                    : escaped;
            }).join(',');
        }).join('\n');
    }
};

// ============================================================================
// SEED ROLL PARSER
// ============================================================================

const SeedRollParser = {
    parse(text) {
        // Try JSON format first (Kindo export)
        try {
            const data = JSON.parse(text);
            if (data.rtype === "roll_student_search_result" && Array.isArray(data.matches)) {
                return this.parseJSON(data.matches);
            }
        } catch (e) {
            // Fall back to TSV/CSV parsing
        }
        
        return this.parseTSV(text);
    },

    parseJSON(matches) {
        const seen = new Set();
        const ids = [];
        const idMap = {};
        
        matches.forEach(student => {
            const fullId = (student.student_id_ext || '').trim();
            if (fullId && fullId.includes('.') && !seen.has(fullId)) {
                seen.add(fullId);
                ids.push(fullId);
                
                const baseId = fullId.split('.')[0];
                idMap[baseId] = fullId;
            }
        });
        
        console.log(`Parsed ${ids.length} student IDs from JSON seed roll`);
        console.log(`Created ID mapping for ${Object.keys(idMap).length} base IDs`);
        
        return { ids, idMap };
    },

    parseTSV(text) {
        const lines = text.replace(/\r\n?/g, '\n').split('\n');
        const seen = new Set();
        const ids = [];
        const idMap = {};
        
        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;

            let columns = trimmed.split('\t');
            if (columns.length === 1) {
                columns = trimmed.split(',');
            }

            const tag = (columns[0] || '').trim().toLowerCase();
            if (tag === 'student' && columns[1]) {
                const fullId = columns[1].trim();
                if (fullId && fullId.includes('.') && !seen.has(fullId)) {
                    seen.add(fullId);
                    ids.push(fullId);
                    
                    const baseId = fullId.split('.')[0];
                    idMap[baseId] = fullId;
                }
            }
        });
        
        console.log(`Parsed ${ids.length} student IDs from TSV seed roll`);
        
        return { ids, idMap };
    }
};

// ============================================================================
// DATA TRANSFORMERS
// ============================================================================

const DataTransformer = {
    KAMAR_HEADERS: [
        "student_id", "Payer_Name_Cached", "zc_Level_LiveGrid", "zc_Tutor_LiveGrid",
        "House_Cached", "zc_LeftDate", "zc_Title_Overide", "Title_Cached",
        "Date_Added", "zc_Amount_Total", "zc_Amount_GST", "zc_Amount_Owing",
        "zc_Amount_Owing_GST", "Payment_Date", "Amount_Paid", "RollOver_Student",
        "Payers__thisCharged::zc_Pays_DD_or_AP", "Account_Cached", "Department_Cached", "Notes"
    ],

    REMOVE_COLUMNS: [
        "Notes", "Payment_Date", "Amount_Paid", "RollOver_Student",
        "Payers__thisCharged::zc_Pays_DD_or_AP", "zc_Amount_GST",
        "zc_Level_LiveGrid", "House_Cached"
    ],

    addHeaders(rows) {
        return [this.KAMAR_HEADERS, ...rows];
    },

    removeColumns(data) {
        const allHeaders = data[0];
        const keepIndices = allHeaders
            .map((h, i) => this.REMOVE_COLUMNS.includes(h) ? null : i)
            .filter(i => i !== null);
        
        const newHeaders = keepIndices.map(i => allHeaders[i]);
        const newRows = data.slice(1).map(row => keepIndices.map(i => row[i]));
        
        return [newHeaders, ...newRows];
    },

    filterZeroOwing(data) {
        const headers = data[0];
        const owingIdx = headers.indexOf("zc_Amount_Owing");
        const removed = [];
        
        const filtered = data.slice(1).filter(row => {
            const val = row[owingIdx];
            const isValid = val && String(val).trim() !== '' && String(Number(val).toFixed(2)) !== '0.00';
            if (!isValid) {
                removed.push(this.createRemovedRecord(row, headers, 'Zero/blank owing amount'));
            }
            return isValid;
        });
        
        return { data: [headers, ...filtered], removed };
    },

    filterPastLeftDate(data) {
        const headers = data[0];
        const leftDateIdx = headers.indexOf("zc_LeftDate");
        const removed = [];
        const today = new Date();
        today.setHours(0,0,0,0);
        
        const filtered = data.slice(1).filter(row => {
            const dateStr = row[leftDateIdx];
            if (!dateStr || String(dateStr).trim() === '') return true;
            
            const leftDate = this.parseDate(dateStr);
            if (leftDate && leftDate <= today) {
                removed.push(this.createRemovedRecord(row, headers, 'Past left date'));
                return false;
            }
            return true;
        });
        
        return { data: [headers, ...filtered], removed };
    },

    filterStaffAndPreEnrol(data) {
        const headers = data[0];
        const tutorIdx = headers.indexOf("zc_Tutor_LiveGrid");
        const removed = [];
        
        const filtered = data.slice(1).filter(row => {
            const tutor = (row[tutorIdx] || '').toLowerCase();
            
            if (tutor.includes('staff') || tutor.includes('admin') || 
                tutor.includes('teacher') || tutor.includes('employee')) {
                removed.push(this.createRemovedRecord(row, headers, 'Staff/Admin'));
                return false;
            }
            
            if (tutor.includes('pre-enrol') || tutor.includes('preenrol') ||
                (tutor.includes('enrol') && !tutor.includes('enrollment'))) {
                removed.push(this.createRemovedRecord(row, headers, 'Pre-enrollment'));
                return false;
            }
            
            return true;
        });
        
        return { data: [headers, ...filtered], removed };
    },

    filterInvalidIds(data) {
        const headers = data[0];
        const idIdx = headers.indexOf("student_id");
        const removed = [];
        
        const filtered = data.slice(1).filter(row => {
            const idStr = (row[idIdx] || '').toString().trim();
            const validId = /^\d+$/.test(idStr) || /^\d+\.\d{4}$/.test(idStr);
            
            if (idStr && !validId) {
                removed.push(this.createRemovedRecord(row, headers, 'Invalid student ID'));
                return false;
            }
            return true;
        });
        
        return { data: [headers, ...filtered], removed };
    },

    appendMOE(data, seedRollIdMap, moeFallback) {
        const headers = data[0];
        const idIdx = headers.indexOf("student_id");
        const hasSeedRollMap = Object.keys(seedRollIdMap).length > 0;
        
        data.slice(1).forEach(row => {
            const currentId = row[idIdx];
            if (!currentId || currentId.includes('.')) return;
            
            const baseId = currentId.trim();
            
            if (hasSeedRollMap && seedRollIdMap[baseId]) {
                row[idIdx] = seedRollIdMap[baseId];
            } else if (moeFallback && /^\d{4}$/.test(moeFallback)) {
                row[idIdx] = baseId + '.' + moeFallback;
            }
        });
        
        return data;
    },

    filterBySeedRoll(data, seedRollIds) {
        if (!seedRollIds || seedRollIds.length === 0) return { data, removed: [] };
        
        const headers = data[0];
        const idIdx = headers.indexOf("student_id");
        const seedSet = new Set(seedRollIds.map(id => id.trim()));
        const removed = [];
        
        const filtered = data.slice(1).filter(row => {
            const studentId = (row[idIdx] || '').trim();
            if (seedSet.has(studentId)) {
                return true;
            } else {
                removed.push(this.createRemovedRecord(row, headers, 'Not in current seed roll'));
                return false;
            }
        });
        
        return { data: [headers, ...filtered], removed };
    },

    filterExcluded(data, excludeIds) {
        if (!excludeIds || excludeIds.length === 0) return { data, removed: [] };
        
        const headers = data[0];
        const idIdx = headers.indexOf("student_id");
        const excludeSet = new Set(excludeIds.map(id => id.trim()));
        const removed = [];
        
        const filtered = data.slice(1).filter(row => {
            const studentId = (row[idIdx] || '').trim();
            if (excludeSet.has(studentId)) {
                removed.push(this.createRemovedRecord(row, headers, 'Already uploaded to Kindo'));
                return false;
            }
            return true;
        });
        
        return { data: [headers, ...filtered], removed };
    },

    filterByPayableNames(data, namesToRemove) {
        const headers = data[0];
        const payableIdx = headers.indexOf("payable_name");
        if (payableIdx === -1) return { data, removed: [] };
        
        const removed = [];
        const filtered = data.slice(1).filter(row => {
            const payableName = row[payableIdx] || '';
            if (namesToRemove.includes(payableName)) {
                removed.push(this.createRemovedRecord(row, headers, 'Filtered by payable name'));
                return false;
            }
            return true;
        });
        
        return { data: [headers, ...filtered], removed };
    },

    addPayableNameColumn(data) {
        const headers = [...data[0], "payable_name"];
        const titleIdx = data[0].indexOf("Title_Cached");
        const dateIdx = data[0].indexOf("Date_Added");
        
        const rows = data.slice(1).map(row => {
            const payableName = PayableNameGenerator.generate(row[titleIdx], row[dateIdx]);
            return [...row, payableName];
        });
        
        return [headers, ...rows];
    },

    parseDate(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return null;
        const [dd, mm, yyyy] = parts;
        const d = new Date(`${yyyy}-${mm}-${dd}`);
        if (isNaN(d.getTime())) return null;
        d.setHours(0,0,0,0);
        return d;
    },

    createRemovedRecord(row, headers, reason) {
        return {
            student_id: row[headers.indexOf("student_id")] || '',
            payer_name: row[headers.indexOf("Payer_Name_Cached")] || '',
            tutor: row[headers.indexOf("zc_Tutor_LiveGrid")] || '',
            title: row[headers.indexOf("Title_Cached")] || '',
            amount_owing: row[headers.indexOf("zc_Amount_Owing")] || '',
            payable_name: row[headers.indexOf("payable_name")] || '',
            reason
        };
    }
};

// ============================================================================
// PAYABLE NAME GENERATOR
// ============================================================================

const PayableNameGenerator = {
    generate(title, dateAdded) {
        let year = this.extractYear(dateAdded);
        let productName = title || "";
        
        if (year) {
            const yearRegex = new RegExp(`\\b${year}\\b`, 'g');
            productName = productName.replace(yearRegex, '').replace(/\s{2,}/g, ' ').trim();
            productName = `${year} ${productName}`.trim();
            
            let prev;
            do {
                prev = productName;
                productName = productName.replace(/(\(\s*\)|\[\s*\]|\{\s*\})/g, '').replace(/\s{2,}/g, ' ').trim();
            } while (productName !== prev);
        }
        
        if (typeof productName.normalize === 'function') {
            productName = productName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        }
        
        productName = productName.replace(/[^a-zA-Z0-9 \.%!&\)\(\-,/:_@#'\$?\+\t]/g, '').replace(/\s{2,}/g, ' ').trim();
        
        if (productName.length > 100) {
            productName = productName.substring(0, 100).trim();
        }
        if (productName.length === 0) {
            productName = "Unnamed Payable";
        }
        
        return productName;
    },

    extractYear(dateAdded) {
        if (!dateAdded || typeof dateAdded !== 'string') return "";
        let match = dateAdded.match(/(\d{4})$/);
        if (!match) match = dateAdded.match(/^(\d{4})/);
        return match ? match[1] : "";
    }
};

// ============================================================================
// FILE GENERATORS
// ============================================================================

const FileGenerator = {
    generatePayables(data) {
        if (!Array.isArray(data) || data.length < 2) return [];
        
        const headers = ["product_name", "product_remarks2", "product_gst_status", 
                        "product_is_donation", "product_ledgercode_or_remarks1", "product_price_in_dollars", "is_voluntary"];
        const colIdx = {};
        data[0].forEach((h, i) => { colIdx[h] = i; });
        
        const seen = new Set();
        const rows = [];
        
        for (const row of data.slice(1)) {
            const title = row[colIdx["Title_Cached"]] || "";
            const dateAdded = row[colIdx["Date_Added"]];
            const productName = PayableNameGenerator.generate(title, dateAdded);
            
            if (seen.has(productName)) continue;
            seen.add(productName);
            
            const gstVal = row[colIdx["zc_Amount_Owing_GST"]];
            const productGstStatus = (gstVal && !isNaN(Number(gstVal)) && String(gstVal).trim() !== "") ? "GST" : "GST exempt";
            
            const nameLower = String(productName).toLowerCase();
            const productIsDonation = (nameLower.includes("donation") || nameLower.includes("contribution")) ? "TRUE" : "FALSE";
            
            // is_voluntary is "yes" if it's a donation, "no" otherwise
            const isVoluntary = productIsDonation === "TRUE" ? "yes" : "no";
            
            const ledger = row[colIdx["Account_Cached"]] || "";
            let productLedgerCode = ledger ? `~LDC_${ledger}` : "";
            if (productLedgerCode.includes("/")) {
                productLedgerCode = productLedgerCode.split("/")[0];
            }
            
            const productPrice = row[colIdx["zc_Amount_Total"]] || "";
            
            rows.push([productName, "", productGstStatus, productIsDonation, productLedgerCode, productPrice, isVoluntary]);
        }
        
        return [headers, ...rows];
    },

    generatePcats(data) {
        if (!Array.isArray(data) || data.length < 2) return [];
        
        const headers = ["proto_payable_name", "pcat"];
        const colIdx = {};
        data[0].forEach((h, i) => { colIdx[h] = i; });
        
        const seen = new Set();
        const rows = [];
        
        for (const row of data.slice(1)) {
            const protoPayableName = row[colIdx["payable_name"]] || "";
            const pcat = row[colIdx["Department_Cached"]] || "";
            const key = protoPayableName + "||" + pcat;
            
            if (seen.has(key)) continue;
            seen.add(key);
            
            rows.push([protoPayableName, pcat]);
        }
        
        return [headers, ...rows];
    },

    generateOutstandings(data) {
        if (!Array.isArray(data) || data.length < 2) return [];
        
        const headers = ["student_id", "payable_name", "amount", "caregiver_id"];
        const colIdx = {};
        data[0].forEach((h, i) => { colIdx[h] = i; });
        
        const rows = data.slice(1).map(row => [
            row[colIdx["student_id"]] || "",
            row[colIdx["payable_name"]] || "",
            row[colIdx["zc_Amount_Owing"]] || "",
            ""
        ]);
        
        return [headers, ...rows];
    },

    generateRemovedStudents(removedRecords) {
        if (!removedRecords || removedRecords.length === 0) return [];
        
        const headers = ['student_id', 'payer_name', 'tutor', 'title', 'amount_owing', 'payable_name', 'removal_reason'];
        const rows = removedRecords.map(s => [
            s.student_id, s.payer_name, s.tutor, s.title, s.amount_owing, s.payable_name || '', s.reason
        ]);
        
        return [headers, ...rows];
    }
};

// ============================================================================
// UI CONTROLLER
// ============================================================================

const UI = {
    renderDuplicates(duplicates) {
        const container = document.getElementById('duplicatesContainer');
        if (!container) return;
        if (!duplicates || duplicates.length === 0) {
            container.innerHTML = '';
            return;
        }
        let html = '<h3>Exceeds Application Limit:</h3>';
        html += '<ul class="exceeds-limit-list">';
        duplicates.forEach(payableName => {
            html += `<li>${this.escapeHtml(payableName)}</li>`;
        });
        html += '</ul>';
        container.innerHTML = html;
    },
    showStatus(message, type = '') {
        const statusEl = document.getElementById('status');
        if (!statusEl) return;
        
        statusEl.textContent = message;
        statusEl.className = 'status-message';
        if (type) statusEl.classList.add(type);
    },

    updateFileStatus(elementId, text, isSuccess = true) {
        const el = document.getElementById(elementId);
        if (!el) return;
        
        el.textContent = text;
        el.style.color = isSuccess ? '#2e7d32' : '#c62828';
    },

    showResults() {
        document.getElementById('resultsSection').style.display = 'block';
        document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
    },

    hideResults() {
        document.getElementById('resultsSection').style.display = 'none';
    },

    renderStats() {
        const stats = state.stats;
        const container = document.getElementById('statsContainer');
        if (!container) return;
        
        let html = '<strong>Processing Summary:</strong>';
        html += `<div>Original records: ${stats.original}</div>`;
        
        if (stats.removed.zeroOwing > 0) html += `<div>Removed (zero owing): ${stats.removed.zeroOwing}</div>`;
        if (stats.removed.pastLeftDate > 0) html += `<div>Removed (past left date): ${stats.removed.pastLeftDate}</div>`;
        if (stats.removed.staff > 0) html += `<div>Removed (staff/admin): ${stats.removed.staff}</div>`;
        if (stats.removed.preEnrol > 0) html += `<div>Removed (pre-enrollment): ${stats.removed.preEnrol}</div>`;
        if (stats.removed.invalidId > 0) html += `<div>Removed (invalid ID): ${stats.removed.invalidId}</div>`;
        if (stats.removed.seedRoll > 0) html += `<div>Removed (not in seed roll): ${stats.removed.seedRoll}</div>`;
        if (stats.removed.excluded > 0) html += `<div>Removed (already uploaded): ${stats.removed.excluded}</div>`;
        if (stats.removed.filtered > 0) html += `<div>Removed (filtered by name): ${stats.removed.filtered}</div>`;
        
        html += `<div style="margin-top: 10px;"><strong>Final records: ${stats.final}</strong></div>`;
        
        container.innerHTML = html;
    },

    renderPreview(data) {
        const preview = document.getElementById('preview');
        if (!preview || !data || data.length < 2) {
            if (preview) preview.innerHTML = '<p>No data to preview.</p>';
            return;
        }
        
        let html = '<table><thead><tr>';
        data[0].forEach(header => {
            html += `<th>${this.escapeHtml(header)}</th>`;
        });
        html += '</tr></thead><tbody>';
        
        const previewRows = data.slice(1, 11);
        previewRows.forEach(row => {
            html += '<tr>';
            for (let i = 0; i < data[0].length; i++) {
                html += `<td>${this.escapeHtml(row[i] || '')}</td>`;
            }
            html += '</tr>';
        });
        
        html += '</tbody>';
        if (data.length > 11) {
            html += `<tfoot><tr><td colspan="${data[0].length}"><em>Showing first 10 of ${data.length - 1} rows</em></td></tr></tfoot>`;
        }
        html += '</table>';
        
        preview.innerHTML = html;
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// ============================================================================
// DOWNLOAD CONTROLLER
// ============================================================================

const DownloadController = {
    download(data, filename) {
        const csvContent = CSVParser.toCSV(data);
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        const schoolSlug = state.config.schoolName
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '');
        
        const finalFilename = (schoolSlug ? schoolSlug + '_' : '') + filename;
        
        const a = document.createElement('a');
        a.href = url;
        a.download = finalFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};

// ============================================================================
// MAIN PROCESSOR
// ============================================================================

const Processor = {
    process() {
        if (!state.csv.raw || state.csv.raw.length === 0) {
            UI.showStatus('No CSV data loaded.', 'error');
            return;
        }
        
        // Warn if no seed roll
        if (state.seedRoll.ids.length === 0) {
            if (!confirm('WARNING: No seed roll loaded.\n\n' +
                'Without the seed roll:\n' +
                '• Student IDs may have incorrect MOE numbers\n' +
                '• Former students may not be filtered out\n\n' +
                'Continue anyway?')) {
                return;
            }
        }
        
        UI.showStatus('Processing data...', '');
        
        // Reset stats
        state.stats = {
            original: 0,
            removed: {
                zeroOwing: 0,
                pastLeftDate: 0,
                staff: 0,
                preEnrol: 0,
                invalidId: 0,
                seedRoll: 0,
                excluded: 0,
                filtered: 0
            },
            final: 0
        };
        state.csv.removed = [];
        
        // Start processing pipeline
        let data = state.csv.raw;
        let result;
        
        // Remove unnecessary columns
        data = DataTransformer.removeColumns(data);
        state.stats.original = data.length - 1;
        
        // Filter zero owing
        result = DataTransformer.filterZeroOwing(data);
        data = result.data;
        state.stats.removed.zeroOwing = result.removed.length;
        state.csv.removed.push(...result.removed);
        
        // Filter past left date
        result = DataTransformer.filterPastLeftDate(data);
        data = result.data;
        state.stats.removed.pastLeftDate = result.removed.length;
        state.csv.removed.push(...result.removed);
        
        // Filter staff and pre-enrol
        result = DataTransformer.filterStaffAndPreEnrol(data);
        data = result.data;
        state.stats.removed.staff = result.removed.filter(r => r.reason === 'Staff/Admin').length;
        state.stats.removed.preEnrol = result.removed.filter(r => r.reason === 'Pre-enrollment').length;
        state.csv.removed.push(...result.removed);
        
        // Filter invalid IDs
        result = DataTransformer.filterInvalidIds(data);
        data = result.data;
        state.stats.removed.invalidId = result.removed.length;
        state.csv.removed.push(...result.removed);
        
        // Append MOE
        data = DataTransformer.appendMOE(data, state.seedRoll.idMap, state.config.moeFallback);
        
        // Filter by seed roll
        result = DataTransformer.filterBySeedRoll(data, state.seedRoll.ids);
        data = result.data;
        state.stats.removed.seedRoll = result.removed.length;
        state.csv.removed.push(...result.removed);
        
        // Filter excluded students
        result = DataTransformer.filterExcluded(data, state.exclude.ids);
        data = result.data;
        state.stats.removed.excluded = result.removed.length;
        state.csv.removed.push(...result.removed);
        
        // Add payable name column
        data = DataTransformer.addPayableNameColumn(data);
        
        state.stats.final = data.length - 1;
        state.csv.processed = data;
        
        // Show results
        UI.showStatus('Processing complete!', 'success');
        UI.renderStats();
        UI.renderPreview(data);
        // Detect duplicates in outstandings (same student_id and payable_name)
        state.csv.duplicates = [];
        if (data.length > 1) {
            const headers = data[0];
            const idIdx = headers.indexOf("student_id");
            const payableIdx = headers.indexOf("payable_name");
            const seen = new Map();
            const uniqueDuplicatePayables = new Set();
            
            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                const key = `${row[idIdx]}||${row[payableIdx]}`;
                if (seen.has(key)) {
                    // We only need the payable name for display
                    uniqueDuplicatePayables.add(row[payableIdx]);
                } else {
                    seen.set(key, i);
                }
            }
            
            // Convert Set to array of payable names only
            state.csv.duplicates = Array.from(uniqueDuplicatePayables);
        }
        UI.renderDuplicates(state.csv.duplicates);
        UI.showResults();
    },

    applyNameFilter() {
        const textarea = document.getElementById('removeNamesTextarea');
        if (!textarea) return;
        
        const namesToRemove = textarea.value
            .split('\n')
            .map(name => name.trim())
            .filter(name => name);
        
        if (namesToRemove.length === 0) {
            UI.showStatus('No payable names entered to filter.', 'error');
            return;
        }
        
        const result = DataTransformer.filterByPayableNames(state.csv.processed, namesToRemove);
        state.csv.processed = result.data;
        state.stats.removed.filtered = result.removed.length;
        state.csv.removed.push(...result.removed);
        state.stats.final = state.csv.processed.length - 1;
        
        UI.renderStats();
        UI.renderPreview(state.csv.processed);
        UI.showStatus('Filter applied successfully.', 'success');
    }
};

// ============================================================================
// EVENT HANDLERS
// ============================================================================

const EventHandlers = {
    init() {
        // CSV file upload
        document.getElementById('csvInputBtn').addEventListener('click', () => {
            document.getElementById('csvInput').click();
        });
        
        document.getElementById('csvInput').addEventListener('change', this.handleCSVUpload);
        
        // Seed roll
        document.getElementById('loadSeedRollBtn').addEventListener('click', this.handleSeedRollLoad);
        
        // Exclude file upload
        document.getElementById('excludeFileBtn').addEventListener('click', () => {
            document.getElementById('excludeFileInput').click();
        });
        
        document.getElementById('excludeFileInput').addEventListener('change', this.handleExcludeUpload);
        
        // Process button
        document.getElementById('processBtn').addEventListener('click', () => Processor.process());
        
        // Config inputs
        document.getElementById('schoolNameInput').addEventListener('input', (e) => {
            state.config.schoolName = e.target.value;
        });
        
        document.getElementById('moeInput').addEventListener('input', (e) => {
            state.config.moeFallback = e.target.value;
        });
        
        // Downloads
        document.getElementById('payablesBtn').addEventListener('click', this.downloadPayables);
        document.getElementById('pcatsBtn').addEventListener('click', this.downloadPcats);
        document.getElementById('outstandingsBtn').addEventListener('click', this.downloadOutstandings);
        document.getElementById('removedBtn').addEventListener('click', this.downloadRemoved);
        document.getElementById('processedBtn').addEventListener('click', this.downloadProcessed);
        document.getElementById('rawBtn').addEventListener('click', this.downloadRaw);
        
        // Reset
        document.getElementById('resetBtn').addEventListener('click', this.handleReset);
        
        // Help
        document.getElementById('helpBtn').addEventListener('click', () => {
            document.getElementById('mainContent').style.display = 'none';
            document.getElementById('helpContent').style.display = 'block';
        });
        
        document.getElementById('backBtn').addEventListener('click', () => {
            document.getElementById('helpContent').style.display = 'none';
            document.getElementById('mainContent').style.display = 'block';
        });
        
        // Collapsible filters
        document.getElementById('filtersToggle').addEventListener('click', this.toggleFilters);
    },

    handleCSVUpload(event) {
        const files = Array.from(event.target.files).filter(f => f.name.toLowerCase().endsWith('.csv'));
        if (files.length === 0) {
            UI.showStatus('Please select at least one CSV file.', 'error');
            return;
        }
        
        UI.updateFileStatus('fileName', files.map(f => f.name).join(', '));
        
        let loaded = 0;
        let allRows = [];
        
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const rows = CSVParser.parse(e.target.result);
                if (rows.length > 0) allRows = allRows.concat(rows);
                
                loaded++;
                if (loaded === files.length) {
                    state.csv.raw = DataTransformer.addHeaders(allRows);
                    document.getElementById('processBtn').disabled = false;
                    UI.showStatus('CSV file(s) loaded successfully.', 'success');
                }
            };
            reader.readAsText(file);
        });
    },

    handleSeedRollLoad() {
        const textarea = document.getElementById('seedRollPaste');
        const text = textarea.value.trim();
        
        if (!text) {
            UI.showStatus('Please paste seed roll data first.', 'error');
            return;
        }
        
        const result = SeedRollParser.parse(text);
        state.seedRoll.ids = result.ids;
        state.seedRoll.idMap = result.idMap;
        
        const statusEl = document.getElementById('seedRollStatus');
        statusEl.textContent = `✓ Loaded ${result.ids.length} students`;
        statusEl.className = 'status-message success';
        
        UI.showStatus('Seed roll loaded successfully.', 'success');
    },

    handleExcludeUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        if (!file.name.toLowerCase().endsWith('.csv')) {
            UI.showStatus('Please select a CSV file.', 'error');
            return;
        }
        
        UI.updateFileStatus('excludeFileName', file.name);
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const rows = CSVParser.parse(e.target.result);
            if (rows.length < 2) {
                UI.showStatus('Exclude file appears empty.', 'error');
                return;
            }
            
            const headers = rows[0];
            const studentIdIdx = headers.indexOf('student_id');
            
            if (studentIdIdx === -1) {
                UI.showStatus('Could not find student_id column.', 'error');
                return;
            }
            
            const idSet = new Set();
            rows.slice(1).forEach(row => {
                const id = (row[studentIdIdx] || '').trim();
                if (id) idSet.add(id);
            });
            
            state.exclude.ids = Array.from(idSet);
            UI.showStatus(`Loaded ${state.exclude.ids.length} student IDs to exclude.`, 'success');
        };
        
        reader.readAsText(file);
    },

    downloadPayables() {
        const data = FileGenerator.generatePayables(state.csv.processed);
        DownloadController.download(data, 'payables.csv');
    },

    downloadPcats() {
        const data = FileGenerator.generatePcats(state.csv.processed);
        DownloadController.download(data, 'pcats.csv');
    },

    downloadOutstandings() {
        const data = FileGenerator.generateOutstandings(state.csv.processed);
        DownloadController.download(data, 'outstandings.csv');
    },

    downloadRemoved() {
        if (state.csv.removed.length === 0) {
            alert('No students were removed.');
            return;
        }
        const data = FileGenerator.generateRemovedStudents(state.csv.removed);
        DownloadController.download(data, 'removed_students.csv');
    },

    downloadProcessed() {
        DownloadController.download(state.csv.processed, 'processed_data.csv');
    },

    downloadRaw() {
        DownloadController.download(state.csv.raw, 'raw_with_headers.csv');
    },

    handleReset() {
        if (!confirm('Are you sure you want to reset? All data will be cleared.')) return;
        
        // Reset state
        state.csv = { raw: [], processed: [], removed: [] };
        state.seedRoll = { ids: [], idMap: {} };
        state.exclude = { ids: [] };
        state.config = { schoolName: '', moeFallback: '' };
        state.stats = { original: 0, removed: {}, final: 0 };
        
        // Reset UI
        document.getElementById('csvInput').value = '';
        document.getElementById('fileName').textContent = '';
        document.getElementById('seedRollPaste').value = '';
        document.getElementById('seedRollStatus').textContent = '';
        document.getElementById('excludeFileInput').value = '';
        document.getElementById('excludeFileName').textContent = '';
        document.getElementById('schoolNameInput').value = '';
        document.getElementById('moeInput').value = '';
        document.getElementById('removeNamesTextarea').value = '';
        document.getElementById('processBtn').disabled = true;
        document.getElementById('status').textContent = '';
        
        UI.hideResults();
        UI.showStatus('Reset complete.', 'success');
    },

    toggleFilters() {
        const content = document.getElementById('filtersContent');
        const icon = document.querySelector('#filtersToggle .toggle-icon');
        
        if (content.style.display === 'none') {
            content.style.display = 'block';
            icon.classList.add('open');
        } else {
            content.style.display = 'none';
            icon.classList.remove('open');
        }
    }
};

// ============================================================================
// INITIALIZE
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    EventHandlers.init();
    console.log('Kamar Outstandings Converter initialized');
});
