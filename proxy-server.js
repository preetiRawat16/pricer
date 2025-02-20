const express = require('express');
const yahooFinance = require('yahoo-finance2').default;
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const port = 3000;

app.use(cors());

const SPREADSHEET_ID = '1-p7Lzh6bUuO_zfqWhv6XAFEzHGrbWR-FS8uN4IS2skg';
const auth = new google.auth.GoogleAuth({
  keyFile: './file.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

function formatDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(date));
}

async function createSheetIfNotExists(sheetName) {
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetExists = spreadsheet.data.sheets.some(sheet => sheet.properties.title === sheetName);
    if (!sheetExists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
      });
    }
  } catch (error) {
    console.error('Error checking/creating sheet:', error);
  }
}

async function appendToSheet(sheetName, data) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:G`,
      valueInputOption: 'RAW',
      resource: { values: data },
    });
  } catch (error) {
    console.error(`Error appending to sheet '${sheetName}':`, error);
  }
}

app.get('/:stockCode', async (req, res) => {
  try {
    const baseStockCode = req.params.stockCode;
    const stockCode = `${baseStockCode}.NS`;
    const stockData = await yahooFinance.quote(stockCode);
    const now = Math.floor(Date.now() / 1000);
    const hundredDaysAgo = now - 60 * 24 * 60 * 60;
    const historicalData = await yahooFinance.historical(stockCode, { period1: hundredDaysAgo, period2: now, interval: '1d' });
    await createSheetIfNotExists(baseStockCode);
    const spreadsheetData = historicalData.map((data, index) => {
      const date = new Date(data.date);
      const close = data.close;
      const previousClose = index === 0 ? close : historicalData[index - 1].close;
      const change = close - previousClose;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      return [formatDate(date.toISOString()), close, change.toFixed(2), gain.toFixed(2), loss.toFixed(2)];
    });
    const first14Gains = spreadsheetData.slice(0, 14).map(row => parseFloat(row[3]) || 0);
    const first14Losses = spreadsheetData.slice(0, 14).map(row => parseFloat(row[4]) || 0);
    const avgGain = first14Gains.length > 0 ? (first14Gains.reduce((a, b) => a + b, 0) / first14Gains.length).toFixed(2) : 0;
    const avgLoss = first14Losses.length > 0 ? (first14Losses.reduce((a, b) => a + b, 0) / first14Losses.length).toFixed(2) : 0;
    spreadsheetData.forEach((row, index) => {
      row.push(index === 13 ? avgGain : '');
      row.push(index === 13 ? avgLoss : '');
    });
    await appendToSheet(baseStockCode, spreadsheetData);
    res.json({ stockCode: baseStockCode, price: stockData.regularMarketPrice });
  } catch (error) {
    console.error('Error fetching data:', error.message);
    res.status(500).json({ error: 'Error fetching data', details: error.message });
  }
});
app.get('/:stockCode/update', async (req, res) => {
  try {
    const baseStockCode = req.params.stockCode; // Get stock name from URL
    const stockCode = `${baseStockCode}.NS`; // Append 'NS' for the Indian market

    // Fetch today's stock quote
    const stockData = await yahooFinance.quote(stockCode);
    if (!stockData || !stockData.regularMarketPrice) {
      throw new Error('Stock data not found');
    }

    // Get current timestamp and calculate yesterday's timestamp
    const now = Math.floor(Date.now() / 1000);
    const yesterday = now - 24 * 60 * 60;

    // Fetch historical data (only yesterday to today)
    const historicalData = await yahooFinance.historical(stockCode, {
      period1: yesterday,
      period2: now,
      interval: '1d',
    });

    if (!historicalData || historicalData.length === 0) {
      throw new Error('No recent historical data available');
    }

    // Extract the latest closing price
    const latestData = historicalData[historicalData.length - 1];
    const date = new Date(latestData.date);
    const close = latestData.close;
    const previousClose = historicalData.length > 1 ? historicalData[historicalData.length - 2].close : close;
    const change = close - previousClose;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    const rowData = [
      [formatDate(date.toISOString()), close, change.toFixed(2), gain.toFixed(2), loss.toFixed(2)],
    ];

    // Ensure sheet exists
    await createSheetIfNotExists(baseStockCode);

    // Append today's data
    await appendToSheet(baseStockCode, rowData);

    res.json({
      message: `Today's data for ${baseStockCode} added successfully`,
      stockCode: baseStockCode,
      date: formatDate(date.toISOString()),
      price: close,
    });
  } catch (error) {
    console.error('Error updating data:', error.message);
    res.status(500).json({ error: 'Error updating data', details: error.message });
  }
});
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
