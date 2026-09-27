import ExcelJS from 'exceljs';

export async function readWorkbookRows(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const rows = [];

  workbook.eachSheet(worksheet => {
    let headers = [];
    worksheet.eachRow((row, rowNumber) => {
      const values = row.values.slice(1).map(value => cellText(value));
      if (rowNumber === 1) {
        headers = values.map(value => String(value || '').trim());
        return;
      }
      if (!headers.some(Boolean)) return;
      rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
    });
  });

  return rows;
}

export async function downloadWorkbook(filename, sheets) {
  const workbook = new ExcelJS.Workbook();
  sheets.forEach(sheet => {
    const worksheet = workbook.addWorksheet(sheet.name);
    const rows = sheet.rows || [];
    const headers = rows.length && !Array.isArray(rows[0]) ? Object.keys(rows[0]) : (sheet.headers || []);
    if (headers.length) worksheet.columns = headers.map(header => ({ header, key: header, width: 24 }));
    rows.forEach(row => worksheet.addRow(Array.isArray(row) ? row : row));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
  }
  return String(value);
}
