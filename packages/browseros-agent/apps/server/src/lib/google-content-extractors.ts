export const DETECT_GOOGLE_APP: string = `
(function() {
  try {
    var href = window.location.href;
    if (href.indexOf('docs.google.com/document') !== -1) return 'docs';
    if (href.indexOf('docs.google.com/spreadsheets') !== -1) return 'sheets';
    if (href.indexOf('docs.google.com/presentation') !== -1) return 'slides';
    return null;
  } catch (e) {
    return null;
  }
})()
`

export const EXTRACT_GOOGLE_DOCS_TEXT: string = `
(function() {
  try {
    var title = document.title.replace(' - Google Docs', '').trim();
    var text = '';
    var method = 'none';

    var paras = document.querySelectorAll('[role="paragraph"], .kix-paragraphrenderer');
    if (paras && paras.length > 0) {
      var parts = [];
      for (var i = 0; i < paras.length; i++) {
        parts.push(paras[i].textContent || '');
      }
      text = parts.join('\\n');
      method = 'kix-paragraph';
    }

    if (!text) {
      var editable = document.querySelectorAll('[contenteditable="true"]');
      if (editable && editable.length > 0) {
        text = editable[0].textContent || '';
        method = 'contenteditable';
      }
    }

    if (!text) {
      var ariaLive = document.querySelectorAll('[aria-live], [aria-label]');
      for (var j = 0; j < ariaLive.length; j++) {
        var t = ariaLive[j].textContent || '';
        if (t.length > text.length) {
          text = t;
          method = 'aria';
        }
      }
    }

    return JSON.stringify({ title: title, text: text, method: method });
  } catch (e) {
    return JSON.stringify({ title: '', text: '', method: 'error', error: e.message });
  }
})()
`

export const EXTRACT_GOOGLE_DOCS_STRUCTURE: string = `
(function() {
  try {
    var title = document.title.replace(' - Google Docs', '').trim();
    var headings = [];
    var wordCount = 0;

    var headingEls = document.querySelectorAll('h1, h2, h3, [role="heading"]');
    for (var i = 0; i < headingEls.length; i++) {
      var el = headingEls[i];
      var text = el.textContent || '';
      var level = parseInt(el.getAttribute('aria-level') || el.tagName.replace('H', '') || '1', 10);
      if (text.trim()) {
        headings.push({ level: level, text: text.trim() });
      }
    }

    if (headings.length === 0) {
      var widgetEls = document.querySelectorAll('.docs-heading-widget, [class*="heading"]');
      for (var j = 0; j < widgetEls.length; j++) {
        var wText = widgetEls[j].textContent || '';
        if (wText.trim()) {
          headings.push({ level: 1, text: wText.trim() });
        }
      }
    }

    var allText = document.body ? (document.body.textContent || '') : '';
    var words = allText.trim().split(/\\s+/);
    wordCount = words.filter(function(w) { return w.length > 0; }).length;

    return JSON.stringify({ title: title, headings: headings, wordCount: wordCount });
  } catch (e) {
    return JSON.stringify({ title: '', headings: [], wordCount: 0, error: e.message });
  }
})()
`

export const EXTRACT_GOOGLE_SHEETS_CONTENT: string = `
(function() {
  try {
    var title = document.title.replace(' - Google Sheets', '').trim();
    var sheets = [];
    var activeSheet = '';
    var activeCellValue = '';

    var formulaBar = document.querySelector('#t-formula-bar-input, [id*="formula"], [aria-label*="formula"], input[type="text"][class*="formula"]');
    if (formulaBar) {
      activeCellValue = formulaBar.value || '';
    }

    var sheetTabs = document.querySelectorAll('.docs-sheet-tab-name, [class*="sheet-tab"] span, [role="tab"]');
    for (var i = 0; i < sheetTabs.length; i++) {
      var name = sheetTabs[i].textContent || '';
      if (name.trim()) sheets.push(name.trim());
    }

    var activeTabEl = document.querySelector('.docs-sheet-active-tab .docs-sheet-tab-name, [role="tab"][aria-selected="true"]');
    if (activeTabEl) {
      activeSheet = activeTabEl.textContent || '';
    } else if (sheets.length > 0) {
      activeSheet = sheets[0];
    }

    return JSON.stringify({
      title: title,
      activeSheet: activeSheet.trim(),
      sheets: sheets,
      activeCellValue: activeCellValue
    });
  } catch (e) {
    return JSON.stringify({ title: '', activeSheet: '', sheets: [], activeCellValue: '', error: e.message });
  }
})()
`

export const EXTRACT_GOOGLE_SLIDES_CONTENT: string = `
(function() {
  try {
    var title = document.title.replace(' - Google Slides', '').trim();
    var text = '';
    var slideCount = 0;
    var currentSlide = 0;

    var thumbnails = document.querySelectorAll('[class*="punch-filmstrip-thumbnail"], [class*="slide-thumbnail"]');
    slideCount = thumbnails.length;

    var activeThumbnail = document.querySelector('[class*="punch-filmstrip-thumbnail-selected"], [class*="slide-thumbnail-selected"]');
    if (activeThumbnail) {
      var siblings = document.querySelectorAll('[class*="punch-filmstrip-thumbnail"], [class*="slide-thumbnail"]');
      for (var i = 0; i < siblings.length; i++) {
        if (siblings[i] === activeThumbnail) {
          currentSlide = i;
          break;
        }
      }
    }

    var titleEl = document.querySelector('.punch-slide-title, [class*="slide-title"]');
    if (titleEl) text += titleEl.textContent || '';

    var bodyEl = document.querySelector('[class*="punch-viewer-speakernotes"], [class*="speaker-notes"]');
    if (bodyEl) {
      var noteText = bodyEl.textContent || '';
      if (noteText.trim()) text += '\\n' + noteText;
    }

    if (!text) {
      var ariaEls = document.querySelectorAll('[role="main"] [aria-label], [role="presentation"] [aria-label]');
      for (var j = 0; j < ariaEls.length; j++) {
        var label = ariaEls[j].getAttribute('aria-label') || '';
        if (label.trim()) text += label + '\\n';
      }
    }

    return JSON.stringify({
      title: title,
      slideCount: slideCount,
      currentSlide: currentSlide,
      text: text.trim()
    });
  } catch (e) {
    return JSON.stringify({ title: '', slideCount: 0, currentSlide: 0, text: '', error: e.message });
  }
})()
`

export const GET_GOOGLE_DOC_ID: string = `
(function() {
  try {
    var href = window.location.href;
    var docMatch = href.match(/\\/document\\/d\\/([a-zA-Z0-9_-]+)\\//);
    if (docMatch) return JSON.stringify({ docId: docMatch[1], appType: 'docs' });

    var sheetMatch = href.match(/\\/spreadsheets\\/d\\/([a-zA-Z0-9_-]+)\\//);
    if (sheetMatch) return JSON.stringify({ docId: sheetMatch[1], appType: 'sheets' });

    var presMatch = href.match(/\\/presentation\\/d\\/([a-zA-Z0-9_-]+)\\//);
    if (presMatch) return JSON.stringify({ docId: presMatch[1], appType: 'slides' });

    return JSON.stringify({ docId: null, appType: null });
  } catch (e) {
    return JSON.stringify({ docId: null, appType: null, error: e.message });
  }
})()
`
