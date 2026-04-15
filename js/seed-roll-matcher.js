(function () {
    const state = {
        seedStudents: [],
        rawEntries: [],
        collapsedEntries: [],
        results: {
            matched: [],
            review: [],
            unmatched: []
        },
        nextReviewId: 1
    };

    const dom = {};

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        dom.seedRollInput = document.getElementById('seedRollInputMatcher');
        dom.studentListInput = document.getElementById('studentListInputMatcher');
        dom.matchBtn = document.getElementById('matchBtnMatcher');
        dom.resetBtn = document.getElementById('resetBtnMatcher');
        dom.copyMatchedBtn = document.getElementById('copyMatchedBtnMatcher');
        dom.downloadMatchedBtn = document.getElementById('downloadMatchedBtnMatcher');
        dom.status = document.getElementById('statusMatcher');
        dom.resultsSection = document.getElementById('resultsSectionMatcher');
        dom.summary = document.getElementById('summaryMatcher');
        dom.outputTableBody = document.getElementById('outputTableBodyMatcher');
        dom.matchedTableBody = document.getElementById('matchedTableBodyMatcher');
        dom.reviewList = document.getElementById('reviewListMatcher');
        dom.unmatchedList = document.getElementById('unmatchedListMatcher');

        dom.matchBtn?.addEventListener('click', handleMatch);
        dom.resetBtn?.addEventListener('click', handleReset);
        dom.copyMatchedBtn?.addEventListener('click', handleCopyMatched);
        dom.downloadMatchedBtn?.addEventListener('click', handleDownloadMatched);
        dom.reviewList?.addEventListener('click', handleReviewAction);
        dom.unmatchedList?.addEventListener('click', handleReviewAction);
    }

    function handleMatch() {
        const seedRollText = (dom.seedRollInput?.value || '').trim();
        const namesText = (dom.studentListInput?.value || '').trim();

        if (!seedRollText) {
            showStatus('Paste the seed roll first.', 'warning');
            return;
        }

        if (!namesText) {
            showStatus('Paste the student names first.', 'warning');
            return;
        }

        try {
            state.seedStudents = parseSeedRoll(seedRollText);
            if (state.seedStudents.length === 0) {
                throw new Error('No students were found in the seed roll.');
            }

            const parsedEntries = parseInputNames(namesText);
            state.rawEntries = parsedEntries.rawEntries;
            state.collapsedEntries = parsedEntries.collapsedEntries;
            if (state.collapsedEntries.length === 0) {
                throw new Error('No usable student names were found in the pasted list.');
            }

            state.nextReviewId = 1;
            state.results = matchEntries(state.collapsedEntries, state.seedStudents);
            renderResults();

            showStatus(
                `Parsed ${state.seedStudents.length} seed roll students and ${state.rawEntries.length} pasted lines (${state.collapsedEntries.length} unique).`,
                'success'
            );
        } catch (error) {
            state.rawEntries = [];
            state.results = { matched: [], review: [], unmatched: [] };
            renderResults();
            showStatus(error.message || 'Unable to process the pasted data.', 'error');
        }
    }

    function handleReset() {
        if (dom.seedRollInput) dom.seedRollInput.value = '';
        if (dom.studentListInput) dom.studentListInput.value = '';

        state.seedStudents = [];
        state.rawEntries = [];
        state.collapsedEntries = [];
        state.results = { matched: [], review: [], unmatched: [] };
        state.nextReviewId = 1;

        renderResults();
        showStatus('', '');
    }

    async function handleCopyMatched() {
        const csvText = buildMatchedCSV(state.results.matched);
        if (!csvText) {
            showStatus('There are no matched rows to copy yet.', 'warning');
            return;
        }

        try {
            await navigator.clipboard.writeText(csvText);
            showStatus('Matched CSV copied to the clipboard.', 'success');
        } catch (error) {
            showStatus('Clipboard copy failed in this browser. Use the download button instead.', 'error');
        }
    }

    function handleDownloadMatched() {
        const csvText = buildMatchedCSV(state.results.matched);
        if (!csvText) {
            showStatus('There are no matched rows to download yet.', 'warning');
            return;
        }

        const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'matched-student-ids.csv';
        link.click();
        URL.revokeObjectURL(url);
    }

    function handleReviewAction(event) {
        const applyButton = event.target.closest('[data-action="apply-match"]');
        if (!applyButton) {
            return;
        }

        const listName = applyButton.getAttribute('data-list');
        const reviewId = applyButton.getAttribute('data-review-id');
        const selectId = applyButton.getAttribute('data-select-id');
        const select = document.getElementById(selectId);

        if (!listName || !reviewId || !select) {
            return;
        }

        const candidateIndex = Number.parseInt(select.value, 10);
        if (Number.isNaN(candidateIndex)) {
            showStatus('Pick a candidate before applying a manual match.', 'warning');
            return;
        }

        applyManualMatch(listName, reviewId, candidateIndex);
    }

    function applyManualMatch(listName, reviewId, candidateIndex) {
        const sourceList = state.results[listName];
        if (!Array.isArray(sourceList)) {
            return;
        }

        const itemIndex = sourceList.findIndex(item => item.reviewId === reviewId);
        if (itemIndex === -1) {
            return;
        }

        const item = sourceList[itemIndex];
        const candidate = item.candidates[candidateIndex];
        if (!candidate) {
            showStatus('That candidate is no longer available.', 'error');
            return;
        }

        sourceList.splice(itemIndex, 1);

        state.results.matched.push({
            originalName: item.originalName,
            occurrenceCount: item.occurrenceCount,
            parsedName: item.parsedName,
            student: candidate.student,
            method: 'manual',
            confidence: candidate.score,
            confidenceLabel: formatPercent(candidate.score),
            candidateSummary: item.candidates.slice(0, 5)
        });

        sortMatchedResults(state.results.matched);
        renderResults();
        showStatus(`Applied a manual match for ${item.originalName}.`, 'success');
    }

    function parseSeedRoll(text) {
        const jsonStudents = parseSeedRollJSON(text);
        if (jsonStudents.length > 0) {
            return dedupeStudents(jsonStudents);
        }

        return dedupeStudents(parseSeedRollRows(text));
    }

    function parseSeedRollJSON(text) {
        try {
            const data = JSON.parse(text);
            const matches = Array.isArray(data)
                ? data
                : data && Array.isArray(data.matches)
                    ? data.matches
                    : [];

            return matches
                .map(student => normalizeSeedStudent(student))
                .filter(Boolean);
        } catch (error) {
            return [];
        }
    }

    function parseSeedRollRows(text) {
        const lines = text.replace(/\r\n?/g, '\n').split('\n');
        const students = [];

        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }

            let columns = trimmed.split('\t');
            if (columns.length === 1) {
                columns = trimmed.split(',');
            }

            const rowTag = (columns[0] || '').trim().toLowerCase();
            if (rowTag !== 'student') {
                return;
            }

            const student = normalizeSeedStudent({
                student_id_ext: columns[1] || '',
                student_id: columns[1] || '',
                first_names: columns[2] || '',
                surname: columns[3] || '',
                class_name: columns[4] || '',
                year_level: columns[5] || ''
            });

            if (student) {
                students.push(student);
            }
        });

        return students;
    }

    function normalizeSeedStudent(student) {
        if (!student || typeof student !== 'object') {
            return null;
        }

        const studentId = firstNonEmpty([
            student.student_id_ext,
            student.student_id,
            student.id,
            student.reference
        ]);
        const firstNames = firstNonEmpty([
            student.first_names,
            student.first_name,
            student.firstname,
            student.given_name,
            student.given_names
        ]);
        const surname = firstNonEmpty([
            student.surname,
            student.last_name,
            student.lastname,
            student.family_name
        ]);

        if (!studentId || !firstNames || !surname) {
            return null;
        }

        const displayName = `${firstNames} ${surname}`.replace(/\s+/g, ' ').trim();
        const normalizedFirst = normalizeName(firstNames);
        const normalizedSurname = normalizeName(surname);
        const firstVariants = buildFirstVariants(firstNames, '');

        return {
            studentId,
            firstNames: firstNames.replace(/\s+/g, ' ').trim(),
            surname: surname.replace(/\s+/g, ' ').trim(),
            className: firstNonEmpty([student.class_name, student.class, student.room]),
            yearLevel: firstNonEmpty([student.year_level, student.year]),
            displayName,
            normalizedFirst,
            normalizedSurname,
            compactFirst: compactName(normalizedFirst),
            compactSurname: compactName(normalizedSurname),
            firstVariants
        };
    }

    function dedupeStudents(students) {
        const byId = new Map();

        students.forEach(student => {
            if (!student || !student.studentId) {
                return;
            }

            if (!byId.has(student.studentId)) {
                byId.set(student.studentId, student);
            }
        });

        return Array.from(byId.values());
    }

    function parseInputNames(text) {
        const lines = text.replace(/\r\n?/g, '\n').split('\n');
        const collapsed = new Map();
        const rawEntries = [];

        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }

            const normalizedName = normalizeSpacing(trimmed);
            const normalizedKey = normalizedName.toLowerCase();

            rawEntries.push({
                originalName: normalizedName,
                key: normalizedKey
            });

            if (!collapsed.has(normalizedKey)) {
                collapsed.set(normalizedKey, {
                    key: normalizedKey,
                    originalName: normalizedName,
                    occurrenceCount: 0
                });
            }

            collapsed.get(normalizedKey).occurrenceCount += 1;
        });

        return {
            rawEntries,
            collapsedEntries: Array.from(collapsed.values())
        };
    }

    function matchEntries(entries, seedStudents) {
        const results = {
            matched: [],
            review: [],
            unmatched: []
        };

        entries.forEach(entry => {
            const evaluation = evaluateEntry(entry, seedStudents);
            if (evaluation.matched) {
                results.matched.push(evaluation.matched);
            }

            if (evaluation.review) {
                results.review.push(evaluation.review);
            }

            if (evaluation.unmatched) {
                results.unmatched.push(evaluation.unmatched);
            }
        });

        sortMatchedResults(results.matched);
        sortReviewResults(results.review);
        sortUnmatchedResults(results.unmatched);
        return results;
    }

    function evaluateEntry(entry, seedStudents) {
        const parseCandidates = parseNameEntry(entry.originalName);
        if (parseCandidates.length === 0) {
            return {
                unmatched: createReviewItem('unmatched', entry, [], 'Unable to parse the pasted name into a usable surname/first-name combination.')
            };
        }

        const exactCandidates = collectExactMatches(parseCandidates, seedStudents);
        if (exactCandidates.length > 0) {
            const bestExact = exactCandidates[0];
            const secondExact = exactCandidates[1];

            if (!secondExact || bestExact.score - secondExact.score >= 0.025) {
                return {
                    matched: createMatchedItem(entry, bestExact.student, bestExact.method, bestExact.score, exactCandidates)
                };
            }

            return {
                review: createReviewItem(
                    'ambiguous',
                    entry,
                    exactCandidates.slice(0, 6),
                    'Multiple exact-looking matches were found in the seed roll.'
                )
            };
        }

        const fuzzyCandidates = collectFuzzyMatches(parseCandidates, seedStudents);
        const closeCandidates = fuzzyCandidates.filter(candidate => candidate.score >= 0.76);
        const bestClose = closeCandidates[0];

        if (bestClose && closeCandidates.length === 1) {
            return {
                matched: createMatchedItem(entry, bestClose.student, 'auto-close', bestClose.score, fuzzyCandidates)
            };
        }

        if (closeCandidates.length > 1) {
            return {
                review: createReviewItem(
                    'ambiguous',
                    entry,
                    closeCandidates.slice(0, 6),
                    'Multiple close matches were found. Pick the correct student manually.'
                )
            };
        }

        const suggestions = fuzzyCandidates.filter(candidate => candidate.score >= 0.58).slice(0, 5);
        return {
            unmatched: createReviewItem(
                'unmatched',
                entry,
                suggestions,
                suggestions.length > 0
                    ? 'No reliable automatic match was found. The best nearby candidates are listed below.'
                    : 'No close match was found in the seed roll.'
            )
        };
    }

    function collectExactMatches(parseCandidates, seedStudents) {
        const byStudentId = new Map();

        parseCandidates.forEach(candidate => {
            seedStudents.forEach(student => {
                if (student.compactSurname !== candidate.compactSurname) {
                    return;
                }

                const matchQuality = getExactFirstNameQuality(candidate.firstVariants, student.firstVariants);
                if (matchQuality === 0) {
                    return;
                }

                const score = 1 + candidate.parseConfidence * 0.02 + matchQuality * 0.01;
                const method = matchQuality >= 3 ? 'exact' : 'exact-alt';
                const current = byStudentId.get(student.studentId);

                if (!current || score > current.score) {
                    byStudentId.set(student.studentId, {
                        student,
                        score,
                        method,
                        parseLabel: candidate.label
                    });
                }
            });
        });

        return Array.from(byStudentId.values()).sort((left, right) => right.score - left.score);
    }

    function collectFuzzyMatches(parseCandidates, seedStudents) {
        const byStudentId = new Map();

        parseCandidates.forEach(candidate => {
            seedStudents.forEach(student => {
                const surnameScore = similarity(candidate.compactSurname, student.compactSurname);
                const firstScore = bestSimilarity(candidate.firstVariants, student.firstVariants);

                if (surnameScore < 0.5 || firstScore < 0.45) {
                    return;
                }

                let score = (surnameScore * 0.7) + (firstScore * 0.3) + (candidate.parseConfidence * 0.03);
                if (surnameScore === 1 && firstScore === 1) {
                    score += 0.05;
                }

                score = Math.min(score, 0.999);

                const current = byStudentId.get(student.studentId);
                if (!current || score > current.score) {
                    byStudentId.set(student.studentId, {
                        student,
                        score,
                        method: 'fuzzy',
                        parseLabel: candidate.label
                    });
                }
            });
        });

        return Array.from(byStudentId.values())
            .sort((left, right) => right.score - left.score)
            .slice(0, 8);
    }

    function createMatchedItem(entry, student, method, score, candidates, reviewId = '') {
        return {
            reviewId,
            originalName: entry.originalName,
            occurrenceCount: entry.occurrenceCount,
            parsedName: `${student.firstNames} ${student.surname}`,
            student,
            method,
            confidence: Math.max(0, Math.min(score, 1)),
            confidenceLabel: formatPercent(Math.max(0, Math.min(score, 1))),
            candidateSummary: candidates.slice(0, 5)
        };
    }

    function createReviewItem(type, entry, candidates, reason, reviewId = '') {
        return {
            reviewId: reviewId || `review-${state.nextReviewId++}`,
            type,
            originalName: entry.originalName,
            occurrenceCount: entry.occurrenceCount,
            parsedName: buildParsedNameLabel(entry.originalName),
            candidates,
            reason
        };
    }

    function buildParsedNameLabel(originalName) {
        const parsed = parseNameEntry(originalName)[0];
        if (!parsed) {
            return 'Unable to parse';
        }

        return `${parsed.firstNames} ${parsed.surname}`.replace(/\s+/g, ' ').trim();
    }

    function sortMatchedResults(results) {
        results.sort((left, right) => left.originalName.localeCompare(right.originalName));
    }

    function sortReviewResults(results) {
        results.sort((left, right) => {
            const leftTopScore = left.candidates[0]?.score || 0;
            const rightTopScore = right.candidates[0]?.score || 0;

            if (rightTopScore !== leftTopScore) {
                return rightTopScore - leftTopScore;
            }

            return left.originalName.localeCompare(right.originalName);
        });
    }

    function sortUnmatchedResults(results) {
        results.sort((left, right) => {
            const leftHasCandidates = left.candidates.length > 0 ? 1 : 0;
            const rightHasCandidates = right.candidates.length > 0 ? 1 : 0;

            if (leftHasCandidates !== rightHasCandidates) {
                return rightHasCandidates - leftHasCandidates;
            }

            const leftTopScore = left.candidates[0]?.score || 0;
            const rightTopScore = right.candidates[0]?.score || 0;

            if (rightTopScore !== leftTopScore) {
                return rightTopScore - leftTopScore;
            }

            return left.originalName.localeCompare(right.originalName);
        });
    }

    function parseNameEntry(rawName) {
        const normalizedRaw = normalizeSpacing(rawName);
        const extracted = extractParenthetical(normalizedRaw);
        const baseLine = normalizeSpacing(extracted.baseText);
        const nicknameHint = extracted.altName;
        const candidates = [];

        if (!baseLine) {
            return candidates;
        }

        if (baseLine.includes(',')) {
            const parts = baseLine.split(',');
            const surname = normalizeSpacing(parts.shift() || '');
            const firstNames = normalizeSpacing(parts.join(' '));
            pushParseCandidate(candidates, {
                surname,
                firstNames,
                nicknameHint,
                parseConfidence: 1,
                label: 'comma'
            });
        } else {
            const uppercaseTail = parseUppercaseSurnameTail(baseLine);
            if (uppercaseTail) {
                pushParseCandidate(candidates, {
                    surname: uppercaseTail.surname,
                    firstNames: uppercaseTail.firstNames,
                    nicknameHint,
                    parseConfidence: 0.95,
                    label: 'uppercase-tail'
                });
            }

            const tokens = baseLine.split(' ').filter(Boolean);
            if (tokens.length >= 2) {
                pushParseCandidate(candidates, {
                    surname: tokens[tokens.length - 1],
                    firstNames: tokens.slice(0, -1).join(' '),
                    nicknameHint,
                    parseConfidence: tokens.length === 2 ? 0.55 : 0.62,
                    label: 'last-token-surname'
                });

                pushParseCandidate(candidates, {
                    surname: tokens[0],
                    firstNames: tokens.slice(1).join(' '),
                    nicknameHint,
                    parseConfidence: tokens.length === 2 ? 0.52 : 0.36,
                    label: 'first-token-surname'
                });
            }
        }

        return candidates;
    }

    function pushParseCandidate(candidates, candidate) {
        const surname = normalizeSpacing(candidate.surname || '');
        const firstNames = normalizeSpacing(candidate.firstNames || '');
        if (!surname || !firstNames) {
            return;
        }

        const normalizedSurname = normalizeName(surname);
        const compactSurname = compactName(normalizedSurname);
        if (!compactSurname) {
            return;
        }

        const firstVariants = buildFirstVariants(firstNames, candidate.nicknameHint || '');
        if (firstVariants.length === 0) {
            return;
        }

        const dedupeKey = `${compactSurname}|${firstVariants.map(item => item.compact).join('|')}`;
        if (candidates.some(existing => existing.dedupeKey === dedupeKey)) {
            return;
        }

        candidates.push({
            surname,
            firstNames,
            nicknameHint: candidate.nicknameHint || '',
            normalizedSurname,
            compactSurname,
            firstVariants,
            parseConfidence: candidate.parseConfidence,
            label: candidate.label,
            dedupeKey
        });
    }

    function parseUppercaseSurnameTail(value) {
        const tokens = value.split(' ').filter(Boolean);
        if (tokens.length < 2) {
            return null;
        }

        const surnameTokens = [];
        for (let index = tokens.length - 1; index >= 0; index -= 1) {
            const token = tokens[index];
            if (!looksLikeUppercaseSurnameToken(token)) {
                break;
            }

            surnameTokens.unshift(token);
        }

        if (surnameTokens.length === 0 || surnameTokens.length === tokens.length) {
            return null;
        }

        const firstNames = tokens.slice(0, tokens.length - surnameTokens.length).join(' ');
        const surname = surnameTokens.join(' ');
        if (!firstNames || !surname) {
            return null;
        }

        return { firstNames, surname };
    }

    function looksLikeUppercaseSurnameToken(token) {
        const stripped = token.replace(/[^A-Za-z'’-]/g, '');
        if (!stripped) {
            return false;
        }

        return stripped === stripped.toUpperCase() && /[A-Z]/.test(stripped);
    }

    function extractParenthetical(value) {
        const lastOpen = value.lastIndexOf('(');
        if (lastOpen === -1) {
            return {
                baseText: value,
                altName: ''
            };
        }

        const baseText = normalizeSpacing(value.slice(0, lastOpen));
        const rawAlt = value.slice(lastOpen + 1).replace(/[)]+/g, '');

        return {
            baseText,
            altName: normalizeSpacing(rawAlt)
        };
    }

    function buildFirstVariants(firstNames, nicknameHint) {
        const variants = [];
        const sources = [firstNames, nicknameHint];

        sources.forEach(value => {
            const normalized = normalizeName(value);
            const compact = compactName(normalized);
            if (!compact) {
                return;
            }

            pushVariant(variants, normalized, compact);

            const tokens = normalized.split(' ').filter(Boolean);
            if (tokens.length > 1) {
                pushVariant(variants, tokens[0], compactName(tokens[0]));
            }

            tokens.forEach(token => {
                if (token.length >= 4) {
                    pushVariant(variants, token, compactName(token));
                }
            });
        });

        return variants;
    }

    function pushVariant(variants, normalized, compact) {
        if (!compact) {
            return;
        }

        if (variants.some(variant => variant.compact === compact)) {
            return;
        }

        variants.push({ normalized, compact });
    }

    function getExactFirstNameQuality(entryVariants, studentVariants) {
        let best = 0;

        entryVariants.forEach(entryVariant => {
            studentVariants.forEach(studentVariant => {
                if (entryVariant.compact !== studentVariant.compact) {
                    return;
                }

                const exactness = entryVariant.normalized === studentVariant.normalized ? 3 : 2;
                if (exactness > best) {
                    best = exactness;
                }
            });
        });

        return best;
    }

    function bestSimilarity(entryVariants, studentVariants) {
        let best = 0;

        entryVariants.forEach(entryVariant => {
            studentVariants.forEach(studentVariant => {
                const score = similarity(entryVariant.compact, studentVariant.compact);
                if (score > best) {
                    best = score;
                }
            });
        });

        return best;
    }

    function similarity(left, right) {
        if (!left || !right) {
            return 0;
        }

        if (left === right) {
            return 1;
        }

        const distance = levenshtein(left, right);
        return 1 - (distance / Math.max(left.length, right.length));
    }

    function levenshtein(left, right) {
        const matrix = [];

        for (let row = 0; row <= right.length; row += 1) {
            matrix[row] = [row];
        }

        for (let column = 0; column <= left.length; column += 1) {
            matrix[0][column] = column;
        }

        for (let row = 1; row <= right.length; row += 1) {
            for (let column = 1; column <= left.length; column += 1) {
                const substitutionCost = left[column - 1] === right[row - 1] ? 0 : 1;
                matrix[row][column] = Math.min(
                    matrix[row - 1][column] + 1,
                    matrix[row][column - 1] + 1,
                    matrix[row - 1][column - 1] + substitutionCost
                );
            }
        }

        return matrix[right.length][left.length];
    }

    function renderResults() {
        const hasResults = state.results.matched.length > 0
            || state.results.review.length > 0
            || state.results.unmatched.length > 0;

        if (dom.resultsSection) {
            dom.resultsSection.hidden = !hasResults;
        }

        renderSummary();
        renderOutputTable();
        renderMatchedTable();
        renderReviewList(dom.reviewList, state.results.review, 'review');
        renderReviewList(dom.unmatchedList, state.results.unmatched, 'unmatched');

        const hasMatched = state.results.matched.length > 0;
        if (dom.copyMatchedBtn) dom.copyMatchedBtn.disabled = !hasMatched;
        if (dom.downloadMatchedBtn) dom.downloadMatchedBtn.disabled = !hasMatched;
    }

    function renderSummary() {
        if (!dom.summary) {
            return;
        }

        const totalUnique = state.collapsedEntries.length;
        const totalRawLines = state.collapsedEntries.reduce((sum, entry) => sum + entry.occurrenceCount, 0);
        const duplicateReduction = totalRawLines - totalUnique;

        const items = [
            { label: 'Seed Roll Students', value: state.seedStudents.length },
            { label: 'Unique Input Names', value: totalUnique },
            { label: 'Duplicate Lines Removed', value: duplicateReduction },
            { label: 'Matched', value: state.results.matched.length },
            { label: 'Review Queue', value: state.results.review.length },
            { label: 'Unmatched', value: state.results.unmatched.length }
        ];

        dom.summary.innerHTML = items.map(item => `
            <div class="summary-card">
                <span class="muted">${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(String(item.value))}</strong>
            </div>
        `).join('');
    }

    function renderMatchedTable() {
        if (!dom.matchedTableBody) {
            return;
        }

        if (state.results.matched.length === 0) {
            dom.matchedTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="muted">No matched rows yet.</td>
                </tr>
            `;
            return;
        }

        dom.matchedTableBody.innerHTML = state.results.matched.map(item => `
            <tr>
                <td>${escapeHtml(item.originalName)}</td>
                <td>${escapeHtml(String(item.occurrenceCount))}</td>
                <td>${escapeHtml(item.student.displayName)}</td>
                <td>${escapeHtml(item.student.studentId)}</td>
                <td><span class="pill ${escapeHtml(item.method)}">${escapeHtml(formatMethod(item.method))}</span></td>
                <td>${escapeHtml(item.confidenceLabel)}</td>
            </tr>
        `).join('');
    }

    function renderOutputTable() {
        if (!dom.outputTableBody) {
            return;
        }

        if (state.rawEntries.length === 0) {
            dom.outputTableBody.innerHTML = `
                <tr>
                    <td colspan="2" class="muted">No pasted students yet.</td>
                </tr>
            `;
            return;
        }

        const resolutionMap = buildResolutionMap();

        dom.outputTableBody.innerHTML = state.rawEntries.map(entry => {
            const resolvedId = resolutionMap.get(entry.key) || 'MISSING';
            return `
                <tr>
                    <td>${escapeHtml(entry.originalName)}</td>
                    <td>${escapeHtml(resolvedId)}</td>
                </tr>
            `;
        }).join('');
    }

    function buildResolutionMap() {
        const resolutionMap = new Map();

        state.results.matched.forEach(item => {
            resolutionMap.set(item.originalName.toLowerCase(), item.student.studentId);
        });

        return resolutionMap;
    }

    function renderReviewList(host, items, listName) {
        if (!host) {
            return;
        }

        if (items.length === 0) {
            host.innerHTML = `<div class="empty-state">Nothing to review here.</div>`;
            return;
        }

        host.innerHTML = items.map(item => renderReviewCard(item, listName)).join('');
    }

    function renderReviewCard(item, listName) {
        const selectId = `${item.reviewId}-select`;
        const options = item.candidates.map((candidate, index) => `
            <option value="${index}">${escapeHtml(candidate.student.displayName)} | ${escapeHtml(candidate.student.studentId)} | ${escapeHtml(formatPercent(candidate.score))}</option>
        `).join('');

        const candidateMarkup = item.candidates.length > 0
            ? `<ol class="candidate-list">${item.candidates.map(candidate => `
                <li>
                    <strong>${escapeHtml(candidate.student.displayName)}</strong>
                    <span class="muted">(${escapeHtml(candidate.student.studentId)})</span>
                    <div class="muted">Score ${escapeHtml(formatPercent(candidate.score))}${candidate.parseLabel ? ` | Parse ${escapeHtml(candidate.parseLabel)}` : ''}</div>
                </li>
            `).join('')}</ol>`
            : '<p class="muted">No suggested candidates were strong enough to list.</p>';

        const reviewControls = item.candidates.length > 0
            ? `
                <div class="review-actions">
                    <label for="${escapeHtml(selectId)}" class="muted">Manual match</label>
                    <select id="${escapeHtml(selectId)}">${options}</select>
                    <button
                        type="button"
                        class="btn btn-secondary"
                        data-action="apply-match"
                        data-list="${escapeHtml(listName)}"
                        data-review-id="${escapeHtml(item.reviewId)}"
                        data-select-id="${escapeHtml(selectId)}"
                    >Apply Selected Match</button>
                </div>
            `
            : '';

        return `
            <article class="review-card ${escapeHtml(item.type)}">
                <h3>${escapeHtml(item.originalName)}</h3>
                <div class="review-meta">
                    <span>Occurrences: ${escapeHtml(String(item.occurrenceCount))}</span>
                    <span>Parsed as: ${escapeHtml(item.parsedName)}</span>
                </div>
                <p>${escapeHtml(item.reason)}</p>
                ${candidateMarkup}
                ${reviewControls}
            </article>
        `;
    }

    function buildMatchedCSV(items) {
        if (!items || items.length === 0) {
            return '';
        }

        const rows = [
            ['original_name', 'occurrence_count', 'matched_student_name', 'student_id', 'method', 'confidence']
        ];

        items.forEach(item => {
            rows.push([
                item.originalName,
                String(item.occurrenceCount),
                item.student.displayName,
                item.student.studentId,
                formatMethod(item.method),
                item.confidenceLabel
            ]);
        });

        return rows.map(columns => columns.map(csvEscape).join(',')).join('\n');
    }

    function csvEscape(value) {
        const text = String(value ?? '');
        if (/[",\n]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }

        return text;
    }

    function showStatus(message, type) {
        if (!dom.status) {
            return;
        }

        dom.status.textContent = message;
        dom.status.className = `status-message${type ? ` ${type}` : ''}`;
    }

    function firstNonEmpty(values) {
        for (const value of values) {
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }

            if (value != null && String(value).trim()) {
                return String(value).trim();
            }
        }

        return '';
    }

    function normalizeSpacing(value) {
        return String(value || '')
            .replace(/\s*,\s*/g, ', ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeName(value) {
        return normalizeSpacing(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Za-z0-9'’ -]/g, ' ')
            .replace(/[-'’]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function compactName(value) {
        return normalizeName(value).replace(/\s+/g, '');
    }

    function formatPercent(value) {
        return `${Math.round(value * 100)}%`;
    }

    function formatMethod(method) {
        switch (method) {
            case 'exact':
                return 'Exact';
            case 'exact-alt':
                return 'Exact Alt';
            case 'fuzzy':
                return 'Fuzzy';
            case 'auto-close':
                return 'Auto Match';
            case 'manual':
                return 'Manual';
            default:
                return method;
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
})();