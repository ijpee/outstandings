// ============================================================================
// APPLICATION STATE
// ============================================================================

const state = {
    csv: {
        raw: [],
        processed: [],
        removed: []
    },
    charges: {
        raw: [],
        map: {}
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
        final: 0,
        payableSources: {
            fromCharges: 0,
            fromCharged: 0,
            chargesOnly: 0,
            totalUnique: 0
        }
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
            
            // Skip if empty or doesn't contain a dot
            if (!fullId || !fullId.includes('.')) return;
            
            // Skip extension URLs or other non-student-ID formats
            if (fullId.includes('://') || fullId.includes('moz-extension')) return;
            
            // Skip if already seen
            if (seen.has(fullId)) return;
            
            // Validate it looks like a student ID (numbers and dots only)
            if (!/^\d+\.\d+$/.test(fullId)) return;
            
            seen.add(fullId);
            ids.push(fullId);
            
            const baseId = fullId.split('.')[0];
            idMap[baseId] = fullId;
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
// CHARGES PARSER
// ============================================================================

// KAMAR charges export is headerless; we normalize by prepending these headers
const CHARGES_HEADERS = [
    "Account","Department","Amount_Donation","Amount_GST_Yes","Amount_GST_No",
    "Charge_Criteria","Charge_Types","Charge_Value","Code","Set",
    "RollOver_Fee","RollOver_Student","Title","TTGrid","Type",
    "zc_Amount_GST","zc_Amount_GST_Excl","zc_Amount_Total",
    "zc_Sum_Amount_Total","zc_Sum_Amount_Paid","zc_Sum_Amount_Owing",
    "Notes","zc_Count_Payees"
];

const ChargesParser = {
    parse(fileContent) {
        // Use the existing CSVParser for proper CSV handling
        const rows = CSVParser.parse(fileContent);

        if (!rows || rows.length === 0) {
            console.log('Charges file appears empty');
            return [];
        }

        // Normalize: prepend headers if missing
        const first = (rows[0] || []).map(v => String(v || '').trim());
        const looksLikeHeader = first.includes('Account') && first.includes('Department') && (first.includes('Title') || first.includes('TTGrid'));
        const startIdx = looksLikeHeader ? 1 : 0;

        // Fixed positional indices (headerless CSVs)
        // 0: Account
        // 1: Department
        // 2: Amount_Donation
        // 3: Amount_GST_Yes
        // 4: Amount_GST_No
        // 12: Title
        // 13: TTGrid (e.g., "2025TT")
        // 15: zc_Amount_GST
        // 17: zc_Amount_Total
        const IDX = {
            Account: 0,
            Department: 1,
            Amount_Donation: 2,
            Amount_GST_Yes: 3,
            Amount_GST_No: 4,
            Title: 12,
            TTGrid: 13,
            zc_Amount_GST: 15,
            zc_Amount_Total: 17
        };

        const data = [];

        for (let i = startIdx; i < rows.length; i++) {
            const values = rows[i] || [];
            // Skip completely empty lines
            const isEmpty = values.every(v => (v === undefined || v === null || String(v).trim() === ''));
            if (isEmpty) continue;

            const safe = idx => (idx >= 0 && idx < values.length) ? (values[idx] || '').trim() : '';

            const row = {
                Account: safe(IDX.Account),
                Department: safe(IDX.Department),
                Amount_Donation: safe(IDX.Amount_Donation),
                Amount_GST_Yes: safe(IDX.Amount_GST_Yes),
                Amount_GST_No: safe(IDX.Amount_GST_No),
                Title: safe(IDX.Title),
                TTGrid: safe(IDX.TTGrid),
                zc_Amount_GST: safe(IDX.zc_Amount_GST),
                zc_Amount_Total: safe(IDX.zc_Amount_Total)
            };

            // Only include rows with at least a Title or TTGrid; others are likely junk
            if (row.Title || row.TTGrid) {
                data.push(row);
            }
        }

        console.log(`Parsed ${data.length} charges from CSV (headerless positional parsing${looksLikeHeader ? ' with header skipped' : ''})`);
        if (data.length > 0) {
            console.log('Sample charge row:', data[0]);
        }

        return data;
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
    },

    extractYearFromTTGrid(ttgrid) {
        // Extract year from TTGrid format (e.g., "2025TT" -> "2025")
        if (!ttgrid || typeof ttgrid !== 'string') return "";
        const match = ttgrid.match(/^(\d{4})/);
        return match ? match[1] : "";
    }
};

// ============================================================================
// FILE GENERATORS
// ============================================================================

const FileGenerator = {
    generatePayables(data, chargesMap = {}) {
        if (!Array.isArray(data) || data.length < 2) return [];
        
    const headers = ["product_name", "product_remarks2", "product_gst_status", 
            "product_is_donation", "product_ledgercode_or_remarks1", "product_price_in_dollars", "is_voluntary"];
        const colIdx = {};
        data[0].forEach((h, i) => { colIdx[h] = i; });
        
        // Build donation set directly from the raw charges CSV (non-blank Amount_Donation)
        const donationByProduct = new Set();
        if (state.charges && state.charges.raw && state.charges.raw.length > 1) {
            const rows = state.charges.raw;
            const headerRow = rows[0] || [];
            const norm = s => String(s || '').trim().toLowerCase();
            const hmap = {};
            headerRow.forEach((h, i) => { hmap[norm(h)] = i; });

            // Prefer header indices, fallback to positional indices
            const idxTitle = (hmap['title'] !== undefined) ? hmap['title'] : 12;
            const idxTTGrid = (hmap['ttgrid'] !== undefined) ? hmap['ttgrid'] : 13;
            const idxDonation = (hmap['amount_donation'] !== undefined) ? hmap['amount_donation'] : 2;

            for (let i = 1; i < rows.length; i++) {
                const r = rows[i] || [];
                const title = String(r[idxTitle] || '').trim();
                const ttgrid = String(r[idxTTGrid] || '').trim();
                const donationRaw = String(r[idxDonation] || '').trim();
                if (!title || !ttgrid) continue;
                const year = PayableNameGenerator.extractYearFromTTGrid(ttgrid);
                if (!year) continue;
                if (donationRaw === '') continue; // only non-blank counts as donation
                const productName = PayableNameGenerator.generate(title, `01/01/${year}`);
                if (productName) donationByProduct.add(productName);
            }
        }
        
        const seen = new Set();
        const rows = [];
        let fromCharges = 0;
        let fromCharged = 0;
        
        // STEP 1: Create ALL payables from charges file first
        if (Object.keys(chargesMap).length > 0) {
            for (const [lookupKey, chargeData] of Object.entries(chargesMap)) {
                const productName = chargeData.payable_name;
                
                if (seen.has(productName)) continue;
                seen.add(productName);
                
                const gstAmount = chargeData.zc_Amount_GST || "";
                const productGstStatus = (gstAmount && !isNaN(Number(gstAmount)) && Number(gstAmount) > 0) ? "GST" : "GST exempt";

                // Donation from charges: non-blank Amount_Donation in raw charges for this product
                const productIsDonation = donationByProduct.has(productName) ? "TRUE" : "FALSE";

                const isVoluntary = productIsDonation === "TRUE" ? "yes" : "no";
                
                const ledger = chargeData.Account || "";
                let productLedgerCode = ledger ? `~LDC_${ledger}` : "";
                if (productLedgerCode.includes("/")) {
                    productLedgerCode = productLedgerCode.split("/")[0];
                }
                
                const productPrice = chargeData.zc_Amount_Total || "";
                
                rows.push([productName, "", productGstStatus, productIsDonation, productLedgerCode, productPrice, isVoluntary]);
                fromCharges++;
            }
        }
        
        // STEP 2: Add any additional payables from charged file (not in charges)
        for (const row of data.slice(1)) {
            const title = row[colIdx["Title_Cached"]] || "";
            const dateAdded = row[colIdx["Date_Added"]];
            const productName = PayableNameGenerator.generate(title, dateAdded);
            
            // Skip if already created from charges
            if (seen.has(productName)) continue;
            seen.add(productName);
            
            // Use old method (from charged file)
            const gstVal = row[colIdx["zc_Amount_Owing_GST"]];
            const productGstStatus = (gstVal && !isNaN(Number(gstVal)) && String(gstVal).trim() !== "") ? "GST" : "GST exempt";
            
            const nameLower = String(productName).toLowerCase();
            const productIsDonation = (nameLower.includes("donation") || nameLower.includes("contribution")) ? "TRUE" : "FALSE";
            
            const isVoluntary = productIsDonation === "TRUE" ? "yes" : "no";
            
            const ledger = row[colIdx["Account_Cached"]] || "";
            let productLedgerCode = ledger ? `~LDC_${ledger}` : "";
            if (productLedgerCode.includes("/")) {
                productLedgerCode = productLedgerCode.split("/")[0];
            }
            
            const productPrice = row[colIdx["zc_Amount_Total"]] || "";
            
            rows.push([productName, "", productGstStatus, productIsDonation, productLedgerCode, productPrice, isVoluntary]);
            fromCharged++;
        }
        
        // Update stats
        state.stats.payableSources.fromCharges = fromCharges;
        state.stats.payableSources.fromCharged = fromCharged;
        
        return [headers, ...rows];
    },

    generatePcats(data, chargesMap = {}) {
        if (!Array.isArray(data) || data.length < 2) return [];
        
        const headers = ["proto_payable_name", "pcat"];
        const colIdx = {};
        data[0].forEach((h, i) => { colIdx[h] = i; });
        
        const seen = new Set();
        const rows = [];
        
        for (const row of data.slice(1)) {
            const protoPayableName = row[colIdx["payable_name"]] || "";
            const title = row[colIdx["Title_Cached"]] || "";
            const dateAdded = row[colIdx["Date_Added"]];
            const year = PayableNameGenerator.extractYear(dateAdded);
            
            // Check if we have charges data for this payable
            const lookupKey = `${title}|${year}`;
            const chargeData = chargesMap[lookupKey];
            
            const pcat = chargeData ? (chargeData.Department || "") : (row[colIdx["Department_Cached"]] || "");
            const key = protoPayableName + "||" + pcat;
            
            if (seen.has(key)) continue;
            seen.add(key);
            
            rows.push([protoPayableName, pcat]);
        }

        // Ensure products that exist only in charges are included
        if (chargesMap && Object.keys(chargesMap).length > 0) {
            for (const entry of Object.values(chargesMap)) {
                const protoPayableName = entry.payable_name || "";
                const pcat = entry.Department || "";
                const key = protoPayableName + "||" + pcat;
                if (!protoPayableName || seen.has(key)) continue;
                seen.add(key);
                rows.push([protoPayableName, pcat]);
            }
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
        
    // Total removed across all categories
    const totalRemoved = Object.values(stats.removed || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    html += `<div><strong>Total removed: ${totalRemoved}</strong></div>`;
        
        // Show concise payables summary only
        const ps = stats.payableSources || {};
        const totalUnique = ps.totalUnique || (ps.fromCharges + ps.fromCharged);
        if (totalUnique > 0) {
            html += `<div style=\"margin-top: 10px;\"><strong>Payables:</strong></div>`;
            html += `<div>Total payables: ${totalUnique}</div>`;
            html += `<div>Extra from charges: ${ps.chargesOnly || 0}</div>`;
        }
        
        html += `<div style="margin-top: 10px;"><strong>Final records: ${stats.final}</strong></div>`;
        
        container.innerHTML = html;
    },

    // Removed renderUnmatchedCharges: we now report only unique payable counts

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
            final: 0,
            payableSources: {
                fromCharges: 0,
                fromCharged: 0,
                chargesOnly: 0,
                totalUnique: 0
            }
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
        
        // Compute unique payable counts (charges-first precedence, then charged fallback)
        (function computePayableCounts() {
            try {
                const chargesNames = new Set();
                if (state.charges && state.charges.map) {
                    for (const k of Object.keys(state.charges.map)) {
                        const nm = state.charges.map[k]?.payable_name || '';
                        if (nm) chargesNames.add(nm);
                    }
                }

                const chargedNames = new Set();
                const headers = data[0];
                const titleIdx = headers.indexOf("Title_Cached");
                const dateIdx = headers.indexOf("Date_Added");
                for (let i = 1; i < data.length; i++) {
                    const row = data[i];
                    const nm = PayableNameGenerator.generate(row[titleIdx] || "", row[dateIdx] || "");
                    if (nm) chargedNames.add(nm);
                }

                let overlap = 0;
                chargesNames.forEach(n => { if (chargedNames.has(n)) overlap++; });

                const fromCharges = chargesNames.size; // unique in charges
                const chargesOnly = fromCharges - overlap; // new due to charges
                const chargedOnly = chargedNames.size - overlap; // additional from charged only
                const totalUnique = fromCharges + chargedOnly; // union size

                state.stats.payableSources = {
                    fromCharges,
                    fromCharged: chargedOnly,
                    chargesOnly,
                    totalUnique
                };
            } catch (err) {
                console.warn('Failed to compute payable counts:', err);
            }
        })();

        // We intentionally do not compute row-level matching stats anymore.
        
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
        // Charges file upload
        document.getElementById('chargesInputBtn').addEventListener('click', () => {
            document.getElementById('chargesInput').click();
        });
        
        document.getElementById('chargesInput').addEventListener('change', this.handleChargesUpload);
        
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

    handleChargesUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        if (!file.name.toLowerCase().endsWith('.csv')) {
            UI.showStatus('Please select a CSV file.', 'error');
            return;
        }
        
        UI.updateFileStatus('chargesFileName', file.name);
        
        const reader = new FileReader();
        reader.onload = function(e) {
            // Parse raw rows
            let rows = CSVParser.parse(e.target.result) || [];
            if (rows.length === 0) {
                UI.showStatus('Charges file appears empty or invalid.', 'error');
                return;
            }

            // Ensure a header row exists (prepend if the file is headerless)
            const first = (rows[0] || []).map(v => String(v || '').trim());
            const looksLikeHeader = first.includes('Account') && first.includes('Department') && (first.includes('Title') || first.includes('TTGrid'));
            if (!looksLikeHeader) {
                rows = [CHARGES_HEADERS, ...rows];
            }

            // Persist raw charges with headers (for consistency with charged)
            state.charges.raw = rows;

            // Build lookup map: Title|Year -> charge data
            const headers = rows[0];
            const col = {};
            headers.forEach((h, i) => { col[h] = i; });
            const get = (row, name) => {
                const i = col[name];
                return (i === undefined || i === null) ? '' : String(row[i] || '').trim();
            };

            state.charges.map = {};

            for (const row of rows.slice(1)) {
                if (!row || row.every(v => String(v || '').trim() === '')) continue;

                const title = get(row, 'Title');
                const ttgrid = get(row, 'TTGrid');
                const year = PayableNameGenerator.extractYearFromTTGrid(ttgrid);
                if (!title || !year) continue;

                const key = `${title}|${year}`;
                const fakeDateForYear = `01/01/${year}`;
                const payableName = PayableNameGenerator.generate(title, fakeDateForYear);

                // Initialize or fetch existing aggregated entry
                const existing = state.charges.map[key] || {
                    Account: '',
                    Department: '',
                    Amount_Donation: '',
                    Amount_GST_Yes: '',
                    Amount_GST_No: '',
                    Title: title,
                    TTGrid: ttgrid,
                    zc_Amount_GST: '',
                    zc_Amount_Total: '',
                    payable_name: payableName,
                    year,
                    donation_present: false
                };

                // Prefer first non-empty values for reference fields
                const acct = get(row, 'Account');
                const dept = get(row, 'Department');
                const gstY = get(row, 'Amount_GST_Yes');
                const gstN = get(row, 'Amount_GST_No');
                const amtGst = get(row, 'zc_Amount_GST');
                const amtTotalRaw = get(row, 'zc_Amount_Total');
                // Normalize total: if blank or <= 0, use "1"
                const amtTotal = (() => {
                    const s = String(amtTotalRaw || '').trim();
                    if (!s) return "1";
                    const num = parseFloat(s.replace(/[^0-9.-]/g, ''));
                    if (isNaN(num) || num <= 0) return "1";
                    return s;
                })();
                const amtDonation = get(row, 'Amount_Donation');

                if (!existing.Account && acct) existing.Account = acct;
                if (!existing.Department && dept) existing.Department = dept;
                if (!existing.Amount_GST_Yes && gstY) existing.Amount_GST_Yes = gstY;
                if (!existing.Amount_GST_No && gstN) existing.Amount_GST_No = gstN;
                if (!existing.zc_Amount_GST && amtGst) existing.zc_Amount_GST = amtGst;
                // Prefer a positive amount; if existing is "1" (fallback), upgrade when a positive amount appears later
                if (!existing.zc_Amount_Total) {
                    existing.zc_Amount_Total = amtTotal;
                } else if (existing.zc_Amount_Total === "1" && amtTotal !== "1") {
                    existing.zc_Amount_Total = amtTotal;
                }

                // Aggregate donation presence across all rows for this key
                if (amtDonation && String(amtDonation).trim() !== '') {
                    existing.donation_present = true;
                }

                // Ensure payable_name remains consistent (first computed)
                state.charges.map[key] = existing;
            }

            console.log(`Built charges lookup map with ${Object.keys(state.charges.map).length} unique keys`);
            UI.showStatus(`Charges file loaded successfully (${rows.length - 1} rows).`, 'success');
        };
        
        reader.readAsText(file);
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
        const data = FileGenerator.generatePayables(state.csv.processed, state.charges.map);
        DownloadController.download(data, 'payables.csv');
    },

    downloadPcats() {
        const data = FileGenerator.generatePcats(state.csv.processed, state.charges.map);
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
        state.charges = { raw: [], map: {} };
        state.seedRoll = { ids: [], idMap: {} };
        state.exclude = { ids: [] };
        state.config = { schoolName: '', moeFallback: '' };
        state.stats = { 
            original: 0, 
            removed: {}, 
            final: 0,
            payableSources: { 
                fromCharges: 0, 
                fromCharged: 0,
                chargesOnly: 0,
                totalUnique: 0
            }
        };
        
        // Reset UI
        document.getElementById('chargesInput').value = '';
        document.getElementById('chargesFileName').textContent = '';
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
