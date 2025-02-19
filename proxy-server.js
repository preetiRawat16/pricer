const express = require('express');
const yahooFinance = require('yahoo-finance2').default;
const cors = require('cors');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors()); // Enable CORS for all routes

// Function to format date as DD/MM/YYYY HH:mm:ss
function formatDate(date) {
  if (typeof date !== 'string' || isNaN(new Date(date).getTime())) {
    console.error('Invalid date:', date);
    return 'Invalid Date';
  }

  const options = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };

  const dateObj = new Date(date);
  if (isNaN(dateObj.getTime())) {
    console.error('Invalid Date object:', dateObj);
    return 'Invalid Date';
  }

  return new Intl.DateTimeFormat('en-GB', options).format(dateObj);
}

// Authenticate with Google Sheets API
const SPREADSHEET_ID = '1-p7Lzh6bUuO_zfqWhv6XAFEzHGrbWR-FS8uN4IS2skg'; // Replace with your Google Sheets ID

const auth = new google.auth.GoogleAuth({
  keyFile: './file.json', // Path to your service account key file.
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], // Scope for Google Sheets API.
});

// Set up Google Sheets API
const sheets = google.sheets({ version: 'v4', auth });

// Function to create a new sheet if it doesn't exist
async function createSheetIfNotExists(sheetName) {
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    const sheetExists = spreadsheet.data.sheets.some(
      (sheet) => sheet.properties.title === sheetName
    );

    if (!sheetExists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                },
              },
            },
          ],
        },
      });
      console.log(`Sheet '${sheetName}' created successfully.`);
    } else {
      console.log(`Sheet '${sheetName}' already exists.`);
    }
  } catch (error) {
    console.error('Error checking/creating sheet:', error);
  }
}

// Function to append data to the specific stock's sheet
async function appendToSheet(sheetName, data) {
  const resource = {
    values: data,
  };

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:F`, // Use the dynamically created sheet
      valueInputOption: 'RAW',
      resource,
    });
    console.log(`Data added to sheet '${sheetName}'`);
  } catch (error) {
    console.error(`Error appending to sheet '${sheetName}':`, error);
  }
}

app.get('/:stockCode', async (req, res) => {
  try {
    const baseStockCode = req.params.stockCode; // Get the stock code from the URL parameter
    const stockCode = `${baseStockCode}.NS`; // Append 'NS' to the stock code for the Indian market

    // Fetch stock quote
    const stockData = await yahooFinance.quote(stockCode);

    if (!stockData || !stockData.regularMarketPrice) {
      throw new Error('Stock data not found');
    }

    // Calculate timestamps for 100 days ago
    const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds
    const hundredDaysAgo = now - 60 * 24 * 60 * 60; // 100 days ago in seconds

    // Fetch historical data
    const historicalData = await yahooFinance.historical(stockCode, {
      period1: hundredDaysAgo, // 100 days ago
      period2: now, // Now
      interval: '1d', // Daily data
    });

    if (!historicalData || historicalData.length === 0) {
      throw new Error('No historical data available');
    }

    // Create the sheet if it doesn't exist
    await createSheetIfNotExists(baseStockCode);

    // Prepare the data for appending to the spreadsheet
    const spreadsheetData = historicalData.map((data, index) => {
      const date = new Date(data.date);
      const close = data.close;
      const previousClose = index === 0 ? close : historicalData[index - 1].close;
      const change = close - previousClose;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      return [
        formatDate(date.toISOString()), // Formatted date
        close, // Close price
        change.toFixed(2), // Change
        gain.toFixed(2), // Gain
        loss.toFixed(2), // Loss
      ];
    });

    // Append data to the newly created stock sheet
    await appendToSheet(baseStockCode, spreadsheetData);

    // Send JSON response with stock price
    res.json({
      stockCode: baseStockCode,
      price: stockData.regularMarketPrice,
    });
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
