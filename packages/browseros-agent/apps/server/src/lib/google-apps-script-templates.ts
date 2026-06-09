export function getDocText(documentId: string): string {
  return `
function main(params) {
  try {
    var docId = params[0] || ${JSON.stringify(documentId)};
    var doc = DocumentApp.openById(docId);
    var body = doc.getBody();
    return body.getText();
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function getDocStructure(documentId: string): string {
  return `
function main(params) {
  try {
    var docId = params[0] || ${JSON.stringify(documentId)};
    var doc = DocumentApp.openById(docId);
    var body = doc.getBody();
    var numChildren = body.getNumChildren();
    var headings = [];
    var paragraphCount = 0;
    var wordCount = 0;

    for (var i = 0; i < numChildren; i++) {
      var child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
        var para = child.asParagraph();
        var text = para.getText();
        var heading = para.getHeading();
        paragraphCount++;
        if (text.trim().length > 0) {
          wordCount += text.trim().split(/\\s+/).length;
        }
        if (heading !== DocumentApp.ParagraphHeading.NORMAL) {
          var level = 1;
          if (heading === DocumentApp.ParagraphHeading.HEADING2) level = 2;
          else if (heading === DocumentApp.ParagraphHeading.HEADING3) level = 3;
          else if (heading === DocumentApp.ParagraphHeading.HEADING4) level = 4;
          else if (heading === DocumentApp.ParagraphHeading.HEADING5) level = 5;
          else if (heading === DocumentApp.ParagraphHeading.HEADING6) level = 6;
          headings.push({ level: level, text: text });
        }
      }
    }

    return JSON.stringify({
      title: doc.getName(),
      headings: headings,
      paragraphCount: paragraphCount,
      wordCount: wordCount
    });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function findInDoc(documentId: string): string {
  return `
function main(params) {
  try {
    var docId = params[0] || ${JSON.stringify(documentId)};
    var searchText = params[1] || '';
    var doc = DocumentApp.openById(docId);
    var body = doc.getBody();
    var results = [];

    if (!searchText) {
      return JSON.stringify({ error: 'searchText param required' });
    }

    var searchResult = body.findText(searchText);
    while (searchResult !== null) {
      var element = searchResult.getElement();
      var para = element.getParent();
      results.push({
        text: element.asText().getText(),
        paragraph: para.getType() === DocumentApp.ElementType.PARAGRAPH
          ? para.asParagraph().getText()
          : element.asText().getText()
      });
      searchResult = body.findText(searchText, searchResult);
    }

    return JSON.stringify(results);
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function insertTextInDoc(documentId: string): string {
  return `
function main(params) {
  try {
    var docId = params[0] || ${JSON.stringify(documentId)};
    var insertions = params[1] || [];
    var doc = DocumentApp.openById(docId);
    var body = doc.getBody();

    for (var i = 0; i < insertions.length; i++) {
      var item = insertions[i];
      if (item.insertAt === 'start') {
        body.insertParagraph(0, item.text);
      } else {
        body.appendParagraph(item.text);
      }
    }

    return JSON.stringify({ ok: true });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function replaceInDoc(documentId: string): string {
  return `
function main(params) {
  try {
    var docId = params[0] || ${JSON.stringify(documentId)};
    var find = params[1] && params[1].find ? params[1].find : '';
    var replace = params[1] && params[1].replace !== undefined ? params[1].replace : '';
    var doc = DocumentApp.openById(docId);
    var body = doc.getBody();

    if (!find) {
      return JSON.stringify({ error: 'find param required' });
    }

    body.replaceText(find, replace);
    return JSON.stringify({ ok: true });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function appendToDoc(documentId: string): string {
  return `
function main(params) {
  try {
    var docId = params[0] || ${JSON.stringify(documentId)};
    var text = params[1] || '';
    var doc = DocumentApp.openById(docId);
    var body = doc.getBody();
    body.appendParagraph(text);
    return JSON.stringify({ ok: true });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function getSheetValues(spreadsheetId: string): string {
  return `
function main(params) {
  try {
    var ssId = params[0] || ${JSON.stringify(spreadsheetId)};
    var range = params[1] || '';
    var ss = SpreadsheetApp.openById(ssId);
    var values;

    if (range) {
      values = ss.getRange(range).getValues();
    } else {
      var sheet = ss.getSheets()[0];
      values = sheet.getDataRange().getValues();
    }

    return JSON.stringify(values);
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function getSheetNames(spreadsheetId: string): string {
  return `
function main(params) {
  try {
    var ssId = params[0] || ${JSON.stringify(spreadsheetId)};
    var ss = SpreadsheetApp.openById(ssId);
    var sheets = ss.getSheets();
    var result = [];

    for (var i = 0; i < sheets.length; i++) {
      result.push({ index: i, name: sheets[i].getName() });
    }

    return JSON.stringify(result);
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function setSheetValues(spreadsheetId: string): string {
  return `
function main(params) {
  try {
    var ssId = params[0] || ${JSON.stringify(spreadsheetId)};
    var opts = params[1] || {};
    var ss = SpreadsheetApp.openById(ssId);
    var sheet = opts.sheet ? ss.getSheetByName(opts.sheet) : ss.getSheets()[0];

    if (!sheet) {
      return JSON.stringify({ error: 'Sheet not found: ' + opts.sheet });
    }

    var range = sheet.getRange(opts.range);
    range.setValues(opts.values);
    return JSON.stringify({ ok: true });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function appendSheetRow(spreadsheetId: string): string {
  return `
function main(params) {
  try {
    var ssId = params[0] || ${JSON.stringify(spreadsheetId)};
    var opts = params[1] || {};
    var ss = SpreadsheetApp.openById(ssId);
    var sheet = opts.sheet ? ss.getSheetByName(opts.sheet) : ss.getSheets()[0];

    if (!sheet) {
      return JSON.stringify({ error: 'Sheet not found: ' + opts.sheet });
    }

    sheet.appendRow(opts.values || []);
    return JSON.stringify({ ok: true });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function findInSheet(spreadsheetId: string): string {
  return `
function main(params) {
  try {
    var ssId = params[0] || ${JSON.stringify(spreadsheetId)};
    var searchText = params[1] || '';
    var ss = SpreadsheetApp.openById(ssId);
    var sheets = ss.getSheets();
    var results = [];

    if (!searchText) {
      return JSON.stringify({ error: 'searchText param required' });
    }

    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      var data = sheet.getDataRange().getValues();
      for (var r = 0; r < data.length; r++) {
        for (var c = 0; c < data[r].length; c++) {
          var cell = String(data[r][c]);
          if (cell.indexOf(searchText) !== -1) {
            results.push({
              sheet: sheet.getName(),
              row: r + 1,
              col: c + 1,
              value: cell
            });
          }
        }
      }
    }

    return JSON.stringify(results);
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function getSlidesContent(presentationId: string): string {
  return `
function main(params) {
  try {
    var presId = params[0] || ${JSON.stringify(presentationId)};
    var presentation = SlidesApp.openById(presId);
    var slides = presentation.getSlides();
    var result = [];

    for (var i = 0; i < slides.length; i++) {
      var slide = slides[i];
      var shapes = slide.getShapes();
      var title = '';
      var bodyParts = [];

      for (var j = 0; j < shapes.length; j++) {
        var shape = shapes[j];
        if (!shape.getText) continue;
        var textRange = shape.getText();
        if (!textRange) continue;
        var text = textRange.asString();
        var placeholder = shape.getPlaceholderType
          ? shape.getPlaceholderType()
          : null;
        if (placeholder === SlidesApp.PlaceholderType.TITLE ||
            placeholder === SlidesApp.PlaceholderType.CENTERED_TITLE) {
          title = text;
        } else {
          if (text.trim()) bodyParts.push(text);
        }
      }

      var notes = '';
      try {
        var notesPage = slide.getNotesPage();
        var noteShapes = notesPage.getShapes();
        for (var k = 0; k < noteShapes.length; k++) {
          if (!noteShapes[k].getText) continue;
          var noteText = noteShapes[k].getText().asString().trim();
          if (noteText) notes = noteText;
        }
      } catch (ignore) {}

      result.push({
        slideIndex: i,
        title: title,
        bodyText: bodyParts.join('\\n'),
        notes: notes
      });
    }

    return JSON.stringify(result);
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function getSlideCount(presentationId: string): string {
  return `
function main(params) {
  try {
    var presId = params[0] || ${JSON.stringify(presentationId)};
    var presentation = SlidesApp.openById(presId);
    return JSON.stringify({
      title: presentation.getName(),
      slideCount: presentation.getSlides().length
    });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function appendSlide(presentationId: string): string {
  return `
function main(params) {
  try {
    var presId = params[0] || ${JSON.stringify(presentationId)};
    var opts = params[1] || {};
    var presentation = SlidesApp.openById(presId);
    var slide = presentation.appendSlide(SlidesApp.PredefinedLayout.TITLE_AND_BODY);
    var shapes = slide.getShapes();

    for (var i = 0; i < shapes.length; i++) {
      var shape = shapes[i];
      if (!shape.getPlaceholderType) continue;
      var ph = shape.getPlaceholderType();
      if ((ph === SlidesApp.PlaceholderType.TITLE ||
           ph === SlidesApp.PlaceholderType.CENTERED_TITLE) && opts.title) {
        shape.getText().setText(opts.title);
      } else if (ph === SlidesApp.PlaceholderType.BODY && opts.body) {
        shape.getText().setText(opts.body);
      }
    }

    return JSON.stringify({ ok: true, slideIndex: presentation.getSlides().length - 1 });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}

export function updateSlideText(presentationId: string): string {
  return `
function main(params) {
  try {
    var presId = params[0] || ${JSON.stringify(presentationId)};
    var opts = params[1] || {};
    var slideIndex = opts.slideIndex || 0;
    var presentation = SlidesApp.openById(presId);
    var slides = presentation.getSlides();

    if (slideIndex >= slides.length) {
      return JSON.stringify({ error: 'slideIndex out of range' });
    }

    var slide = slides[slideIndex];
    var shapes = slide.getShapes();

    for (var i = 0; i < shapes.length; i++) {
      var shape = shapes[i];
      if (!shape.getText) continue;
      shape.getText().replaceAllText(opts.find, opts.replace);
    }

    return JSON.stringify({ ok: true });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
`
}
