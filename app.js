    // Load environment variables for local development
    require('dotenv').config();

    const express = require('express');
    const WebSocket = require('ws');

    const app = express();
    // Render provides the PORT environment variable
    const PORT = process.env.PORT || 3000;
    const EODHD_API_KEY = process.env.EODHD_API_KEY;
    // Optional secret to protect your HTTP endpoint
    const SHARED_SECRET = process.env.SHARED_SECRET;

    if (!EODHD_API_KEY) {
        console.error("FATAL ERROR: EODHD_API_KEY environment variable is not set.");
        process.exit(1); // Exit if API key is missing
    }

    // --- Simple In-Memory Store for Latest Prices ---
    // Structure: { "SYMBOL.EXCHANGE": { price: 123.45, timestamp: 1678886400000, type: 'trade'/'quote'/'crypto'/'forex' } }
    const latestPrices = {};

    // --- WebSocket Connection Logic ---
    let wsClient = null;
    const eodhdUsTradeEndpoint = `wss://ws.eodhistoricaldata.com/ws/us?api_token=${EODHD_API_KEY}`;
    // Add other endpoints if needed (e.g., Forex, Crypto)
    // const eodhdForexEndpoint = `wss://ws.eodhistoricaldata.com/ws/forex?api_token=${EODHD_API_KEY}`;

    function connectWebSocket() {
        console.log(`Attempting to connect to EODHD WebSocket: ${eodhdUsTradeEndpoint}`);
        // Close existing connection if any before reconnecting
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
             console.log("Closing existing WebSocket connection before reconnecting.");
             wsClient.close();
        } else if (wsClient) {
             console.log("Terminating potentially stale WebSocket connection.");
             wsClient.terminate(); // Force close if not open
        }


        wsClient = new WebSocket(eodhdUsTradeEndpoint);

        wsClient.on('open', () => {
            console.log('WebSocket connected to EODHD (US Trades).');
            // *** Subscribe to symbols here! ***
            // Start with a few symbols for testing
            const symbolsToSubscribe = ['AAPL.US', 'MSFT.US', 'TSLA.US']; // Use EODHD format
            wsClient.send(JSON.stringify({
                action: 'subscribe',
                symbols: symbolsToSubscribe.join(',')
            }));
            console.log(`Subscribed to: ${symbolsToSubscribe.join(', ')}`);

            // Add subscriptions for other endpoints if connected
        });

        wsClient.on('message', (data) => {
            try {
                const messageString = data.toString();
                // Handle potential non-JSON messages (like acknowledgements)
                if (!messageString.startsWith('{')) {
                     console.log(`Received non-JSON message: ${messageString}`);
                     return;
                }
                const message = JSON.parse(messageString);

                // --- Store the latest price ---
                const symbol = message.s; // Assuming 's' is the symbol field for US Trades
                let price = null;
                let type = 'trade'; // Assuming US Trades endpoint

                if (message.p !== undefined) { // US Trade Data uses 'p'
                    price = message.p;
                }
                // Add 'else if' blocks here for other endpoints (Forex 'a'/'b', Crypto 'p', US Quote 'ap'/'bp')

                if (symbol && price !== null) {
                    latestPrices[symbol] = {
                        price: parseFloat(price),
                        timestamp: message.t || Date.now(), // Use provided timestamp or now
                        type: type
                    };
                   // console.log(`Updated ${symbol}: ${price}`); // Can be noisy, uncomment for debug
                } else {
                    // console.warn("Received message without symbol or price:", message);
                }

            } catch (error) {
                console.error('Error processing WebSocket message:', error);
                console.error('Received data:', data.toString());
            }
        });

        wsClient.on('error', (error) => {
            console.error('WebSocket Error:', error.message);
            // The 'close' event will usually fire after an error, triggering reconnection logic
        });

        wsClient.on('close', (code, reason) => {
            console.log(`WebSocket closed. Code: ${code}, Reason: ${reason.toString()}. Attempting reconnect in 5 seconds...`);
            wsClient = null; // Clear the reference
            setTimeout(connectWebSocket, 5000); // Retry connection after 5 seconds
        });
    }

    // --- HTTP Server Logic ---
    app.get('/latest-price', (req, res) => {
        // Optional: Check for a shared secret header
        if (SHARED_SECRET && req.headers['x-shared-secret'] !== SHARED_SECRET) {
            console.warn("Attempted access to /latest-price with invalid/missing secret.");
            return res.status(403).json({ error: 'Forbidden' });
        }

        const symbol = req.query.symbol; // e.g., AAPL.US

        if (!symbol) {
            return res.status(400).json({ error: 'Missing required query parameter: symbol' });
        }

        const priceData = latestPrices[symbol.toUpperCase()]; // Ensure case consistency

        if (priceData) {
            console.log(`Serving latest price for ${symbol}: ${priceData.price}`);
            res.status(200).json(priceData);
        } else {
            console.log(`No price data found for ${symbol}`);
            res.status(404).json({ error: `Price data not found for symbol: ${symbol}` });
        }
    });

    // Simple health check endpoint
    app.get('/health', (req, res) => {
         res.status(200).json({
              status: 'OK',
              websocket_status: wsClient ? wsClient.readyState : 'Not Initialized/Closed', // 0:CONNECTING, 1:OPEN, 2:CLOSING, 3:CLOSED
              stored_symbols: Object.keys(latestPrices).length
         });
    });

    // Start the HTTP server
    app.listen(PORT, () => {
        console.log(`HTTP server listening on port ${PORT}`);
        // Initial WebSocket connection
        connectWebSocket();
    });