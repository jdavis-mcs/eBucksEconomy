const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
// USE THE SAFE PRINTER FILE WE MADE EARLIER
const { printReceipt, printVoucher, printTest } = require('./printer'); 

const app = express();
const PORT = 3535;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('DB Error:', err.message);
    else console.log('Connected to SQLite database.');
});

db.serialize(() => {
    // --- TABLES ---
    db.run(`CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price REAL, stock INTEGER, barcode TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, role TEXT, pin TEXT, hourly_rate REAL DEFAULT 15.00, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS vouchers (id TEXT PRIMARY KEY, amount REAL, is_used INTEGER DEFAULT 0, user_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS timesheets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, clock_in DATETIME, clock_out DATETIME, total_hours REAL, is_paid INTEGER DEFAULT 0)`);
    
    // NEW: PRINTERS
    db.run(`CREATE TABLE IF NOT EXISTS printers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, ip_address TEXT, assignment TEXT)`);
    
    // NEW: FINANCIALS & TRACKING
    db.run(`CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, total_cost REAL, item_count INTEGER, created_at DATETIME)`);
    db.run(`CREATE TABLE IF NOT EXISTS sales_log (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT, item_name TEXT, price REAL, sold_at DATETIME)`);

    // Bootstrap Admin
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        if (row.count === 0) db.run("INSERT INTO users (name, role, pin, hourly_rate) VALUES (?, ?, ?, ?)", ['TEACHER', 'Admin', '0000', 50.00]);
    });
});

// --- HELPER: GET PRINTER IP ---
function getPrinterIP(assignment, callback) {
    db.get("SELECT ip_address FROM printers WHERE assignment = ?", [assignment], (err, row) => {
        if (row && row.ip_address) callback(row.ip_address);
        else callback(null); 
    });
}

// --- UPDATED PURCHASE LOGIC ---
app.post('/api/purchase', (req, res) => {
    const { voucherIds, totalCost, cartItems } = req.body;
    const placeholders = voucherIds.map(() => '?').join(',');

    // 1. Validate Vouchers
    db.all(`SELECT * FROM vouchers WHERE id IN (${placeholders}) AND is_used=0`, voucherIds, (e, vouchers) => {
        if(vouchers.length !== voucherIds.length) return res.status(400).json({error: "Invalid Vouchers"});
        
        const totalVoucherValue = vouchers.reduce((a,b)=>a+b.amount, 0);
        if(totalVoucherValue < totalCost) return res.status(400).json({error: "Insufficient Funds"});

        // 2. Determine Owner (Use the user_id from the first voucher)
        const ownerId = vouchers[0].user_id;
        
        // 3. Mark Vouchers Used
        db.run(`UPDATE vouchers SET is_used=1 WHERE id IN (${placeholders})`, voucherIds, () => {
            
            // 4. Create Transaction Record
            const transactionId = Math.random().toString(36).substring(2, 10).toUpperCase();
            db.run("INSERT INTO transactions (id, total_cost, item_count, created_at) VALUES (?,?,?,?)", 
                [transactionId, totalCost, cartItems.length, new Date().toISOString()]);

            // 5. Update Inventory & Log Sales (Linked to Transaction)
            cartItems.forEach(i => {
                db.run("UPDATE inventory SET stock=stock-1 WHERE id=?", [i.id]);
                db.run("INSERT INTO sales_log (transaction_id, item_name, price, sold_at) VALUES (?, ?, ?, ?)", 
                    [transactionId, i.name, i.price, new Date().toISOString()]);
            });
            
            getPrinterIP('POS', (ip) => {
                const change = totalVoucherValue - totalCost;
                let changeId = null;

                // 6. Handle Change (Assign back to Owner!)
                if(change > 0) {
                    changeId = Math.random().toString(36).substring(2,10).toUpperCase();
                    
                    // Lookup Owner Name for the Receipt
                    db.get("SELECT name FROM users WHERE id=?", [ownerId], (err, user) => {
                        const ownerName = user ? user.name : "BEARER";
                        
                        // Insert Change Voucher LINKED TO OWNER
                        db.run("INSERT INTO vouchers (id, amount, user_id) VALUES (?,?,?)", [changeId, change, ownerId || null]);
                        
                        // Print Change Voucher
                        printVoucher(ip, {id: changeId, amount: change, user_name: ownerName});
                        
                        // Print Receipt
                        printReceipt(ip, cartItems, totalCost);
                        res.json({success:true, change, changeId});
                    });
                } else {
                    printReceipt(ip, cartItems, totalCost);
                    res.json({success:true, change: 0, changeId: null});
                }
            });
        });
    });
});

// --- NEW FINANCIALS ENDPOINT ---
app.get('/api/financials', (req, res) => {
    // Get all transactions
    db.all("SELECT * FROM transactions ORDER BY created_at DESC", (err, transactions) => {
        if(err) return res.json([]);
        
        // Get all items sold
        db.all("SELECT * FROM sales_log", (err, items) => {
            // Combine them manually for the frontend
            const report = transactions.map(t => {
                return {
                    ...t,
                    items: items.filter(i => i.transaction_id === t.id).map(i => i.item_name)
                };
            });
            res.json(report);
        });
    });
});

// --- STATS ENDPOINT (Updated for new schema) ---
app.get('/api/stats', (req, res) => {
    const stats = {};
    db.get("SELECT SUM(amount) as total FROM vouchers WHERE is_used = 0", (e, r) => {
        stats.circulation = r.total || 0;
        db.get("SELECT count(*) as count FROM users", (e, r) => {
            stats.userCount = r.count || 1;
            stats.avgPerPerson = stats.circulation / stats.userCount;
            db.all("SELECT item_name, COUNT(*) as count FROM sales_log GROUP BY item_name ORDER BY count DESC LIMIT 5", (e, r) => {
                stats.topItems = r;
                db.get("SELECT SUM(total_cost) as total FROM transactions", (e, r) => {
                    stats.lifetimeRevenue = r.total || 0;
                    res.json(stats);
                });
            });
        });
    });
});

// --- STANDARD ENDPOINTS (Existing) ---
app.get('/api/printers', (req, res) => { db.all("SELECT * FROM printers", (e,r) => res.json(r)); });
app.post('/api/printers', (req, res) => {
    const { name, ip_address, assignment } = req.body;
    db.run("INSERT INTO printers (name, ip_address, assignment) VALUES (?,?,?)", [name, ip_address, assignment], function(err){ res.json({success:true, id: this.lastID}); });
});
app.delete('/api/printers/:id', (req, res) => { db.run("DELETE FROM printers WHERE id=?", [req.params.id], ()=>res.json({success:true})); });
app.post('/api/printers/test', (req, res) => { const { ip } = req.body; printTest(ip); res.json({success: true}); });

app.post('/api/mint', (req, res) => {
    const { amount, userId } = req.body;
    const vid = Math.random().toString(36).substring(2, 10).toUpperCase();
    getPrinterIP('PAYROLL', (ip) => {
        db.get("SELECT name FROM users WHERE id=?", [userId], (e,u) => {
            db.run("INSERT INTO vouchers (id, amount, user_id) VALUES (?,?,?)", [vid, amount, userId], () => {
                printVoucher(ip, {id: vid, amount: amount, user_name: u ? u.name : null});
                res.json({success:true});
            });
        });
    });
});

app.post('/api/payroll/process', (req, res) => {
    getPrinterIP('PAYROLL', (ip) => {
        db.all(`SELECT t.user_id, u.name, SUM(t.total_hours) as hours, u.hourly_rate FROM timesheets t JOIN users u ON t.user_id = u.id WHERE t.is_paid = 0 AND t.clock_out IS NOT NULL GROUP BY t.user_id`, [], (err, rows) => {
            if(err || rows.length === 0) return res.json({success: true, count: 0});
            rows.forEach(userPay => {
                const payAmount = userPay.hours * userPay.hourly_rate;
                const voucherId = Math.random().toString(36).substring(2, 10).toUpperCase();
                db.run("INSERT INTO vouchers (id, amount, user_id) VALUES (?, ?, ?)", [voucherId, payAmount, userPay.user_id], () => {
                    db.run("UPDATE timesheets SET is_paid = 1 WHERE user_id = ? AND is_paid = 0 AND clock_out IS NOT NULL", [userPay.user_id], () => {
                        printVoucher(ip, { id: voucherId, amount: payAmount, user_name: userPay.name + " (PAYROLL)" });
                    });
                });
            });
            res.json({ success: true, count: rows.length });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { pin } = req.body;
    db.get("SELECT * FROM users WHERE pin = ?", [pin], (err, row) => {
        if (!row) return res.status(401).json({ error: "Invalid PIN" });
        res.json({ success: true, user: row });
    });
});
app.get('/api/users', (req, res) => db.all("SELECT * FROM users ORDER BY name ASC", (e,r)=>res.json(r)));
app.post('/api/users', (req, res) => {
    const { name, role, pin, hourly_rate } = req.body;
    db.run("INSERT INTO users (name, role, pin, hourly_rate) VALUES (?, ?, ?, ?)", [name, role, pin, hourly_rate], ()=>res.json({success:true}));
});
app.delete('/api/users/:id', (req, res) => db.run("DELETE FROM users WHERE id=?", [req.params.id], ()=>res.json({success:true})));
app.get('/api/users/:id/details', (req, res) => {
    const userId = req.params.id;
    const resObj = {};
    db.all("SELECT * FROM vouchers WHERE user_id = ? AND is_used = 0", [userId], (e, r1) => {
        resObj.activeVouchers = r1;
        db.all("SELECT * FROM vouchers WHERE user_id = ? AND is_used = 1", [userId], (e, r2) => {
            resObj.usedVouchers = r2;
            db.all("SELECT * FROM timesheets WHERE user_id = ? ORDER BY clock_in DESC LIMIT 20", [userId], (e, r3) => {
                resObj.timesheets = r3;
                resObj.balance = r1.reduce((a,b)=>a+b.amount,0);
                res.json(resObj);
            });
        });
    });
});
app.get('/api/payroll/unpaid', (req, res) => db.all(`SELECT t.id, t.user_id, t.total_hours, u.name, u.hourly_rate FROM timesheets t JOIN users u ON t.user_id = u.id WHERE t.is_paid = 0 AND t.clock_out IS NOT NULL`,(e,r)=>res.json(r)));
app.post('/api/clock', (req, res) => {
    const { pin } = req.body;
    db.get("SELECT * FROM users WHERE pin = ?", [pin], (err, user) => {
        if (!user) return res.status(401).json({ error: "Invalid PIN" });
        db.get("SELECT * FROM timesheets WHERE user_id = ? AND clock_out IS NULL", [user.id], (err, sheet) => {
            if (sheet) {
                const now = new Date();
                const hours = (now - new Date(sheet.clock_in)) / 36e5;
                db.run("UPDATE timesheets SET clock_out = ?, total_hours = ? WHERE id = ?", [now.toISOString(), hours, sheet.id], () => res.json({success:true, action:"OUT", user:user.name, hours:hours.toFixed(2)}));
            } else {
                db.run("INSERT INTO timesheets (user_id, clock_in) VALUES (?, ?)", [user.id, new Date().toISOString()], () => res.json({success:true, action:"IN", user:user.name}));
            }
        });
    });
});
app.get('/api/inventory', (req, res) => db.all("SELECT * FROM inventory", (e,r) => res.json(r)));
app.post('/api/inventory', (req, res) => { 
    const {name, price, stock, barcode} = req.body;
    db.run("INSERT INTO inventory (name, price, stock, barcode) VALUES (?,?,?,?)", [name,price,stock,barcode], function(){ res.json({id:this.lastID}) });
});
app.delete('/api/inventory/:id', (req, res) => db.run("DELETE FROM inventory WHERE id=?", [req.params.id], ()=>res.json({success:true})) );

app.listen(PORT, () => console.log(`System Online: http://localhost:${PORT}`));