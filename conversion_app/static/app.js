/**
 * Rapid Document Conversion - Interactive Frontend Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // Application State
  const state = {
    file: null,
    sourceFormat: '',
    targetFormat: '',
    goal: 'share_print',
    supportedMatrix: {},
    conversionResult: null,
    isProcessing: false,
  };

  // Authoritative Offline Conversion Matrix & Rule-Based Recommendation Dictionary
  const LOCAL_SUPPORTED_MATRIX = {
    txt: ['pdf', 'docx', 'html', 'md'],
    md: ['pdf', 'docx', 'html', 'txt'],
    docx: ['txt', 'md', 'html', 'pdf'],
    pdf: ['txt', 'md'],
    html: ['txt', 'md', 'pdf'],
    png: ['jpg', 'webp', 'pdf', 'bmp'],
    jpg: ['png', 'webp', 'pdf', 'bmp'],
    jpeg: ['png', 'webp', 'pdf', 'bmp'],
    webp: ['png', 'jpg', 'pdf', 'bmp'],
    bmp: ['png', 'jpg', 'webp', 'pdf'],
  };

  const LOCAL_REASONS = {
    'txt->pdf': 'Converts plain text into a fixed-layout, paginated PDF suitable for universal reading and printing.',
    'txt->docx': 'Converts plain text into a styled Microsoft Word document ready for further editing.',
    'txt->html': 'Generates clean, styled HTML markup suitable for web browsers.',
    'txt->md': 'Formats plain text as Markdown for code documentation and lightweight markup.',
    'md->pdf': 'Renders Markdown headings, lists, and code blocks into a formatted, professional PDF document.',
    'md->html': 'Transpiles Markdown syntax into semantic HTML5 elements.',
    'md->docx': 'Transforms structured Markdown into a styled Word document.',
    'docx->pdf': 'Renders Word paragraphs and tables into an immutable PDF representation.',
    'docx->md': 'Extracts structured text from Word into portable, git-friendly Markdown.',
    'docx->txt': 'Extracts clean plain text, removing complex formatting for indexing or quick reading.',
    'docx->html': 'Converts document paragraphs and styles into web-friendly HTML.',
    'pdf->txt': 'Extracts readable text layers from the PDF document for editing or search indexing.',
    'pdf->md': 'Extracts text content formatted into structured Markdown blocks.',
    'html->pdf': 'Converts HTML markup into a print-ready PDF document.',
    'png->webp': 'Recompresses PNG into modern WebP with smaller file size and transparency retention.',
    'png->pdf': 'Packages the image into a standardized PDF page.',
    'jpg->webp': 'Significantly reduces image size while maintaining visual fidelity for web delivery.',
    'jpg->pdf': 'Encapsulates the photograph or scan into a shareable single-page PDF document.',
    'webp->png': 'Converts modern WebP back into universal PNG format for maximum legacy compatibility.',
  };

  function computeLocalRecommendation(src, goal) {
    const targets = LOCAL_SUPPORTED_MATRIX[src] || [];
    if (!targets.length) {
      return { targets: [], recommended: null, reason: `Format '${src}' is not supported.` };
    }

    let recommended = null;
    if (goal === 'share_print') {
      recommended = targets.includes('pdf') ? 'pdf' : targets[0];
    } else if (goal === 'editing') {
      recommended = targets.includes('docx') ? 'docx' : targets.includes('md') ? 'md' : targets[0];
    } else if (goal === 'web_publishing') {
      recommended = targets.includes('html') ? 'html' : targets.includes('webp') ? 'webp' : targets[0];
    } else if (goal === 'lightweight_text') {
      recommended = targets.includes('txt') ? 'txt' : targets.includes('md') ? 'md' : targets[0];
    } else if (goal === 'archival') {
      recommended = targets.includes('pdf') ? 'pdf' : targets[0];
    } else {
      recommended = targets[0];
    }

    const reasonKey = `${src}->${recommended}`;
    const reason = LOCAL_REASONS[reasonKey] || `Transforms ${src.toUpperCase()} to ${recommended.toUpperCase()} optimized for ${goal.replace('_', ' ')}.`;

    return { targets, recommended, reason };
  }

  // DOM Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const dropzoneContent = document.getElementById('dropzone-content');
  const filePreview = document.getElementById('file-preview');
  const previewTypePill = document.getElementById('preview-type-pill');
  const previewFilename = document.getElementById('preview-filename');
  const previewFilesize = document.getElementById('preview-filesize');
  const clearFileBtn = document.getElementById('clear-file-btn');
  const contentPreviewBox = document.getElementById('content-preview-box');
  const previewSnippet = document.getElementById('preview-snippet');
  const previewImage = document.getElementById('preview-image');

  const goalButtons = document.querySelectorAll('.goal-btn');
  const recBox = document.getElementById('recommendation-box');
  const recBadge = document.getElementById('rec-target-badge');
  const recReasonText = document.getElementById('rec-reason-text');
  const targetChipsContainer = document.getElementById('target-formats-container');

  const convertBtn = document.getElementById('convert-btn');
  const btnSpinner = document.getElementById('btn-spinner');
  const convertBtnText = document.getElementById('convert-btn-text');

  const emptyState = document.getElementById('empty-state');
  const progressContainer = document.getElementById('progress-container');
  const progressFill = document.getElementById('progress-fill');
  const progressPercent = document.getElementById('progress-percent');
  const progressPhaseTitle = document.getElementById('progress-phase-title');
  const errorCard = document.getElementById('error-card');
  const errorMessage = document.getElementById('error-message');

  const resultsContainer = document.getElementById('results-container');
  const resultStatusPill = document.getElementById('result-status-pill');
  const resultTransLabel = document.getElementById('result-trans-label');
  const resultOutputName = document.getElementById('result-output-name');
  const resultSummaryText = document.getElementById('result-summary-text');
  const downloadBtn = document.getElementById('download-btn');
  const convertAnotherBtn = document.getElementById('convert-another-btn');
  const checksList = document.getElementById('checks-list');
  const auditCounter = document.getElementById('audit-counter');
  const metricsGrid = document.getElementById('metrics-grid');
  const issuesCard = document.getElementById('issues-card');
  const issuesList = document.getElementById('issues-list');
  const uploadStatusCallout = document.getElementById('upload-status-callout');
  const emptyStateTitle = document.getElementById('empty-state-title');
  const emptyStateDesc = document.getElementById('empty-state-desc');

  // Step Indicators
  const stepNodes = {
    upload: document.getElementById('step-upload'),
    convert: document.getElementById('step-convert'),
    validate: document.getElementById('step-validate'),
    ready: document.getElementById('step-ready'),
  };

  // Initialize: Load capabilities & health
  initApp();

  async function initApp() {
    try {
      const [healthRes, formatsRes] = await Promise.all([
        fetch('/health').catch(() => null),
        fetch('/formats').catch(() => null),
      ]);

      if (formatsRes && formatsRes.ok) {
        const data = await formatsRes.json();
        state.supportedMatrix = data.supported_conversions || LOCAL_SUPPORTED_MATRIX;
      } else {
        state.supportedMatrix = LOCAL_SUPPORTED_MATRIX;
      }
    } catch (e) {
      state.supportedMatrix = LOCAL_SUPPORTED_MATRIX;
    }
  }

  // Prevent browser from directly opening dragged files across the entire window
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    window.addEventListener(evt, (e) => {
      e.preventDefault();
    }, false);
  });

  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelected(files[0]);
    }
  });

  // Prevent click on fileInput from bubbling back up to dropzone
  fileInput.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  dropzone.addEventListener('click', (e) => {
    // If a file is already loaded, do not reopen dialog on dropzone background click
    // The user must click the explicit "Change File" button
    if (state.file) {
      return;
    }
    if (clearFileBtn.contains(e.target) || e.target === clearFileBtn) {
      return;
    }
    // If clicked on the label or browse button, let the browser handle it natively without double-triggering
    if (e.target.closest('label[for="file-input"]') || e.target.id === 'file-input') {
      return;
    }
    fileInput.click();
  });

  fileInput.addEventListener('click', () => {
    // Reset on click so selecting the exact same file again still fires change
    fileInput.value = '';
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      const selected = fileInput.files[0];
      handleFileSelected(selected);
    }
  });

  clearFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetFileInput();
  });

  function resetFileInput() {
    state.file = null;
    state.sourceFormat = '';
    state.targetFormat = '';
    fileInput.value = '';

    filePreview.classList.add('hidden');
    if (contentPreviewBox) contentPreviewBox.classList.add('hidden');
    dropzoneContent.classList.remove('hidden');
    recBox.classList.add('hidden');
    if (uploadStatusCallout) uploadStatusCallout.classList.add('hidden');
    if (emptyStateTitle) emptyStateTitle.textContent = "No Conversion Active";
    if (emptyStateDesc) emptyStateDesc.textContent = "Choose an input file and target format on the left to start the serverless transformation and automated quality audit.";
    targetChipsContainer.classList.remove('has-jelly-radio');
    targetChipsContainer.innerHTML = '<span class="empty-hint">Upload a document to reveal supported target formats</span>';
    formatRadio = null;

    updateConvertButton();
  }

  function handleFileSelected(file) {
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      showError('File is too large', 'Maximum permitted file size is 10 MB.');
      return;
    }

    state.file = file;
    const parts = file.name.split('.');
    const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
    state.sourceFormat = ext;

    // Update Dropzone Preview Strip
    previewFilename.textContent = file.name;
    previewFilesize.textContent = formatBytes(file.size);
    previewTypePill.textContent = (ext || 'BIN').toUpperCase();

    dropzoneContent.classList.add('hidden');
    filePreview.classList.remove('hidden');
    if (uploadStatusCallout) uploadStatusCallout.classList.remove('hidden');

    // Generate immediate content snippet preview
    if (contentPreviewBox) {
      contentPreviewBox.classList.remove('hidden');
      previewSnippet.classList.add('hidden');
      previewImage.classList.add('hidden');

      if (['txt', 'md', 'html'].includes(ext)) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const sample = (e.target.result || '').slice(0, 300);
          previewSnippet.textContent = sample || '[Empty document content]';
          previewSnippet.classList.remove('hidden');
        };
        reader.readAsText(file.slice(0, 4096));
      } else if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
        const reader = new FileReader();
        reader.onload = (e) => {
          previewImage.src = e.target.result;
          previewImage.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
      } else {
        previewSnippet.textContent = `${ext.toUpperCase()} document (${formatBytes(file.size)}) staged for conversion.`;
        previewSnippet.classList.remove('hidden');
      }
    }

    hideError();

    // Instant recommendation calculation
    const rec = computeLocalRecommendation(ext, state.goal);
    state.targetFormat = rec.recommended;

    if (rec.recommended) {
      recBadge.textContent = rec.recommended.toUpperCase();
      recReasonText.textContent = rec.reason;
      recBox.classList.remove('hidden');
    }

    renderTargetChips(rec.targets, state.targetFormat);

    if (emptyStateTitle) emptyStateTitle.textContent = "Document Selected: Ready to Convert";
    if (emptyStateDesc) emptyStateDesc.textContent = `File "${file.name}" loaded (${formatBytes(file.size)}). Target format is set to ${state.targetFormat ? state.targetFormat.toUpperCase() : 'recommended'}. Click the Convert button to begin!`;

    updateConvertButton();
  }

  // Standard SVG Icons for UI
  const ICONS = {
    doc: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
    edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>',
    web: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>',
    bolt: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
    archive: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
    folder: '<svg class="btn-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
    boltBtn: '<svg class="btn-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
    pass: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>',
    fail: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    arrowRight: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin:0 4px;"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>'
  };

  // Goal Selector (React Bits JellyRadio)
  let goalRadio = null;
  let formatRadio = null;
  const goalContainer = document.getElementById('goal-options');

  if (window.JellyRadio && goalContainer) {
    goalContainer.classList.add('has-jelly-radio');
    goalRadio = window.JellyRadio.create(goalContainer, {
      items: [
        { value: 'share_print', label: 'Share / Print', icon: ICONS.doc },
        { value: 'editing', label: 'Easy Editing', icon: ICONS.edit },
        { value: 'web_publishing', label: 'Web Publishing', icon: ICONS.web },
        { value: 'lightweight_text', label: 'Plain Text', icon: ICONS.bolt },
        { value: 'archival', label: 'Archival', icon: ICONS.archive }
      ],
      defaultValue: state.goal || 'share_print',
      size: 'md',
      gap: 8,
      radius: 18,
      swell: 0.2,
      barge: 6,
      shrink: 0.05,
      jelly: 1,
      bounce: 0.25,
      stagger: 22,
      stiffness: 580,
      chipColor: 'rgba(255, 255, 255, 0.05)',
      activeColor: '#7b4dff',
      textColor: '#cbd5e1',
      activeTextColor: '#ffffff',
      ariaLabel: 'Primary Conversion Goal',
      onChange: (value) => {
        state.goal = value;
        if (state.sourceFormat) {
          const rec = computeLocalRecommendation(state.sourceFormat, state.goal);
          state.targetFormat = rec.recommended;
          if (rec.recommended) {
            recBadge.textContent = rec.recommended.toUpperCase();
            recReasonText.textContent = rec.reason;
            recBox.classList.remove('hidden');
          }
          renderTargetChips(rec.targets, state.targetFormat);
          updateConvertButton();
        }
      }
    });
  } else {
    // Fallback if JellyRadio is not loaded
    goalButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        goalButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.goal = btn.getAttribute('data-goal');
        if (state.sourceFormat) {
          const rec = computeLocalRecommendation(state.sourceFormat, state.goal);
          state.targetFormat = rec.recommended;
          if (rec.recommended) {
            recBadge.textContent = rec.recommended.toUpperCase();
            recReasonText.textContent = rec.reason;
            recBox.classList.remove('hidden');
          }
          renderTargetChips(rec.targets, state.targetFormat);
          updateConvertButton();
        }
      });
    });
  }

  function renderTargetChips(targets, activeTarget) {
    targetChipsContainer.innerHTML = '';
    targetChipsContainer.classList.remove('has-jelly-radio');

    if (!targets || targets.length === 0) {
      targetChipsContainer.innerHTML = '<span class="empty-hint">No conversion pathways available for this format.</span>';
      formatRadio = null;
      return;
    }

    if (window.JellyRadio) {
      targetChipsContainer.classList.add('has-jelly-radio');
      formatRadio = window.JellyRadio.create(targetChipsContainer, {
        items: targets.map(tgt => ({
          value: tgt,
          label: tgt.toUpperCase()
        })),
        defaultValue: activeTarget || targets[0],
        size: 'md',
        gap: 8,
        radius: 18,
        swell: 0.22,
        barge: 6,
        shrink: 0.05,
        jelly: 1,
        bounce: 0.25,
        stagger: 22,
        stiffness: 580,
        chipColor: 'rgba(255, 255, 255, 0.05)',
        activeColor: '#7b4dff',
        textColor: '#cbd5e1',
        activeTextColor: '#ffffff',
        ariaLabel: 'Target Format Options',
        onChange: (tgt) => {
          state.targetFormat = tgt;
          updateConvertButton();
        }
      });
    } else {
      targets.forEach(tgt => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `format-chip ${tgt === activeTarget ? 'active' : ''}`;
        chip.textContent = tgt.toUpperCase();
        chip.addEventListener('click', () => {
          document.querySelectorAll('.format-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          state.targetFormat = tgt;
          updateConvertButton();
        });
        targetChipsContainer.appendChild(chip);
      });
    }
  }

  function updateConvertButton() {
    convertBtn.classList.remove('pulse-action');
    if (state.file && state.targetFormat && !state.isProcessing) {
      convertBtn.disabled = false;
      convertBtn.classList.add('pulse-action');
      convertBtnText.innerHTML = `${ICONS.boltBtn} <span>Convert to ${state.targetFormat.toUpperCase()} Now</span>`;
    } else if (state.file && !state.targetFormat && !state.isProcessing) {
      convertBtn.disabled = true;
      convertBtnText.textContent = 'Select a Target Format';
    } else if (state.isProcessing) {
      convertBtn.disabled = true;
      convertBtnText.textContent = 'Processing Conversion...';
    } else {
      // No file selected yet: clicking prompts file selection
      convertBtn.disabled = false;
      convertBtnText.innerHTML = `${ICONS.folder} <span>Choose Document to Upload</span>`;
    }
  }

  // Conversion Execution & Upload Trigger
  convertBtn.addEventListener('click', async () => {
    if (!state.file) {
      // User pressed the button without a file: open file dialog immediately
      fileInput.click();
      return;
    }
    if (!state.targetFormat || state.isProcessing) return;

    state.isProcessing = true;
    updateConvertButton();
    hideError();

    emptyState.classList.add('hidden');
    resultsContainer.classList.add('hidden');
    progressContainer.classList.remove('hidden');

    animateProgress(15, 'Reading & Encoding Document...', 'upload');

    try {
      const fileBase64 = await readFileAsBase64(state.file);

      animateProgress(45, `Converting ${state.sourceFormat.toUpperCase()} → ${state.targetFormat.toUpperCase()}...`, 'convert');

      const response = await fetch('/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: state.file.name,
          source_format: state.sourceFormat,
          target_format: state.targetFormat,
          content_base64: fileBase64,
          goal: state.goal,
        }),
      });

      animateProgress(80, 'Running Quality Validation Suite...', 'validate');

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Conversion encountered an error on the server.');
      }

      animateProgress(100, 'Conversion & Validation Complete!', 'ready');
      state.conversionResult = result;

      setTimeout(() => {
        progressContainer.classList.add('hidden');
        renderResults(result);
      }, 500);

    } catch (err) {
      progressContainer.classList.add('hidden');
      showError('Conversion Failed', err.message);
    } finally {
      state.isProcessing = false;
      updateConvertButton();
    }
  });

  function animateProgress(percent, phaseTitle, stepKey) {
    progressFill.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    progressPhaseTitle.textContent = phaseTitle;

    Object.keys(stepNodes).forEach(k => stepNodes[k].classList.remove('active', 'done'));
    if (stepKey === 'upload') {
      stepNodes.upload.classList.add('active');
    } else if (stepKey === 'convert') {
      stepNodes.upload.classList.add('done');
      stepNodes.convert.classList.add('active');
    } else if (stepKey === 'validate') {
      stepNodes.upload.classList.add('done');
      stepNodes.convert.classList.add('done');
      stepNodes.validate.classList.add('active');
    } else if (stepKey === 'ready') {
      stepNodes.upload.classList.add('done');
      stepNodes.convert.classList.add('done');
      stepNodes.validate.classList.add('done');
      stepNodes.ready.classList.add('done');
    }
  }

  function renderResults(job) {
    const val = job.validation || {};
    const status = val.status || 'PASS';

    resultStatusPill.className = `status-pill status-${status.toLowerCase()}`;
    const statusSvg = status === 'PASS' ? ICONS.pass : status === 'WARNING' ? ICONS.warn : ICONS.fail;
    resultStatusPill.innerHTML = `<span class="status-icon">${statusSvg}</span> ${status}`;

    resultTransLabel.innerHTML = `${job.source_format.toUpperCase()} ${ICONS.arrowRight} ${job.target_format.toUpperCase()}`;
    resultOutputName.textContent = job.output_filename;
    resultSummaryText.textContent = val.summary || 'Document converted and processed successfully.';

    // Validation Checks
    checksList.innerHTML = '';
    const checks = val.checks || [];
    const passedCount = checks.filter(c => c.status === 'PASS').length;
    auditCounter.textContent = `${passedCount}/${checks.length} Passed`;

    checks.forEach(chk => {
      const row = document.createElement('div');
      row.className = 'check-item';
      const iconClass = chk.status.toLowerCase();
      const checkIconSvg = chk.status === 'PASS' ? ICONS.pass : chk.status === 'WARNING' ? ICONS.warn : ICONS.fail;

      row.innerHTML = `
        <span class="check-status-icon ${iconClass}">${checkIconSvg}</span>
        <div>
          <div class="check-name">${chk.name}</div>
          <div class="check-msg">${chk.message}</div>
        </div>
      `;
      checksList.appendChild(row);
    });

    // Metrics Grid
    metricsGrid.innerHTML = '';
    const metrics = val.metrics || {};
    const cells = [
      { label: 'Input Size', val: formatBytes(metrics.input_bytes || job.input_bytes) },
      { label: 'Output Size', val: formatBytes(metrics.output_bytes || job.output_bytes) },
      { label: 'Size Ratio', val: `${metrics.size_ratio || '1.0'}x` },
      {
        label: metrics.page_count !== undefined ? 'Page Count' : metrics.character_count !== undefined ? 'Characters' : 'Structure Mode',
        val: metrics.page_count !== undefined ? `${metrics.page_count} pgs` : metrics.character_count !== undefined ? `${Number(metrics.character_count).toLocaleString()} chars` : (metrics.dimensions || 'Standard')
      },
    ];

    cells.forEach(c => {
      const el = document.createElement('div');
      el.className = 'metric-cell';
      el.innerHTML = `
        <div class="metric-label">${c.label}</div>
        <div class="metric-value">${c.val}</div>
      `;
      metricsGrid.appendChild(el);
    });

    // Render Detected Issues & Guidance if warnings/failures occur
    const issues = val.issues || [];
    issuesList.innerHTML = '';
    if (issues.length > 0) {
      issues.forEach(iss => {
        const item = document.createElement('div');
        item.className = `issue-item ${iss.severity ? iss.severity.toLowerCase() : 'warn'}`;
        item.innerHTML = `
          <div class="issue-check-title">${iss.check} (${iss.severity || 'Notice'})</div>
          <div class="issue-text">${iss.issue}</div>
          <div class="issue-recommendation"><strong>Guidance:</strong> ${iss.recommendation}</div>
        `;
        issuesList.appendChild(item);
      });
      issuesCard.classList.remove('hidden');
    } else {
      issuesCard.classList.add('hidden');
    }

    resultsContainer.classList.remove('hidden');
  }

  // Download Trigger
  downloadBtn.addEventListener('click', () => {
    if (!state.conversionResult) return;
    const job = state.conversionResult;

    if (job.output_base64) {
      const byteCharacters = atob(job.output_base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: job.content_type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = job.output_filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else if (job.download_url) {
      window.location.href = job.download_url;
    }
  });

  convertAnotherBtn.addEventListener('click', () => {
    resetFileInput();
    resultsContainer.classList.add('hidden');
    emptyState.classList.remove('hidden');
  });

  // Error Handling
  function showError(title, msg) {
    document.getElementById('error-title').textContent = title;
    errorMessage.textContent = msg;
    errorCard.classList.remove('hidden');
  }

  function hideError() {
    errorCard.classList.add('hidden');
  }

  // Helpers
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result;
        const b64 = res.split(',')[1];
        resolve(b64);
      };
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
});
