// This file acts as a root-level proxy for cPanel / Phusion Passenger 
// which often looks for "app.js" or "index.js" by default at the application root.
try { require('dotenv').config(); } catch(e) {}
require('./dist/server.cjs');
