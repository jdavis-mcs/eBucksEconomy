const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const printer = require('./printer'); 

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
    db.run(`CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, total_cost REAL, item_count INTEGER, created_at DATETIME)`);
    db.run(`CREATE TABLE IF NOT EXISTS sales_log (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT, item_name TEXT, price REAL, sold_at DATETIME)`);
    db.run(`CREATE TABLE IF NOT EXISTS printers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, ip_address TEXT, assignment TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER, message TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS late_work_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, assignment_name TEXT, status TEXT DEFAULT 'Pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    // Bootstrap Admin
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        if (row.count === 0) db.run("INSERT INTO users (name, role, pin, hourly_rate) VALUES (?, ?, ?, ?)", ['TEACHER', 'Admin', '0000', 50.00]);
    });
});

// --- USER MANAGEMENT (CRUD) ---
app.get('/api/users', (req, res) => db.all("SELECT * FROM users ORDER BY name ASC", (e,r)=>res.json(r)));
app.post('/api/users', (req, res) => {
    const { name, role, pin, hourly_rate } = req.body;
    db.run("INSERT INTO users (name, role, pin, hourly_rate) VALUES (?, ?, ?, ?)", [name, role, pin, hourly_rate], function(err) {
        if(err) return res.status(500).json({error: err.message});
        res.json({success:true, id: this.lastID});
    });
});
app.put('/api/users/:id', (req, res) => {
    const { name, role, pin, hourly_rate } = req.body;
    db.run("UPDATE users SET name=?, role=?, pin=?, hourly_rate=? WHERE id=?", [name, role, pin, hourly_rate, req.params.id], (err) => {
        if(err) return res.status(500).json({error: err.message});
        res.json({success:true});
    });
});
app.delete('/api/users/:id', (req, res) => {
    db.run("DELETE FROM users WHERE id=?", [req.params.id], (err) => {
        if(err) return res.status(500).json({error: err.message});
        res.json({success:true});
    });
});

// --- INVENTORY MANAGEMENT (CRUD) ---
app.get('/api/inventory', (req, res) => db.all("SELECT * FROM inventory", (e,r) => res.json(r)));
app.post('/api/inventory', (req, res) => { 
    const {name, price, stock, barcode} = req.body;
    db.run("INSERT INTO inventory (name, price, stock, barcode) VALUES (?,?,?,?)", [name,price,stock,barcode], function(){ res.json({id:this.lastID}) });
});
app.put('/api/inventory/:id', (req, res) => {
    const { name, price, stock, barcode } = req.body;
    db.run("UPDATE inventory SET name=?, price=?, stock=?, barcode=? WHERE id=?", [name, price, stock, barcode, req.params.id], (err) => {
        if(err) return res.status(500).json({error: err.message});
        res.json({success:true});
    });
});
app.delete('/api/inventory/:id', (req, res) => db.run("DELETE FROM inventory WHERE id=?", [req.params.id], ()=>res.json({success:true})) );


// --- CORE FUNCTIONS ---
app.post('/api/purchase', (req, res) => {
    const { voucherIds, totalCost, cartItems } = req.body;
    const placeholders = voucherIds.map(() => '?').join(',');

    db.all(`SELECT * FROM vouchers WHERE id IN (${placeholders}) AND is_used=0`, voucherIds, (e, vouchers) => {
        if(!vouchers || vouchers.length !== voucherIds.length) return res.status(400).json({error: "Invalid Vouchers"});
        
        const totalVoucherValue = vouchers.reduce((a,b)=>a+b.amount, 0);
        if(totalVoucherValue < totalCost) return res.status(400).json({error: "Insufficient Funds"});

        const ownerId = vouchers[0].user_id;
        
        db.run(`UPDATE vouchers SET is_used=1 WHERE id IN (${placeholders})`, voucherIds, () => {
            const transactionId = Math.random().toString(36).substring(2, 10).toUpperCase();
            db.run("INSERT INTO transactions (id, total_cost, item_count, created_at) VALUES (?,?,?,?)", 
                [transactionId, totalCost, cartItems.length, new Date().toISOString()]);

            cartItems.forEach(i => {
                db.run("UPDATE inventory SET stock=stock-1 WHERE id=?", [i.id]);
                db.run("INSERT INTO sales_log (transaction_id, item_name, price, sold_at) VALUES (?, ?, ?, ?)", 
                    [transactionId, i.name, i.price, new Date().toISOString()]);
            });
            
            const change = totalVoucherValue - totalCost;
            let changeId = null;
            let printQueue = [];

            if(change > 0) {
                changeId = Math.random().toString(36).substring(2,10).toUpperCase();
                db.get("SELECT name FROM users WHERE id=?", [ownerId], (err, user) => {
                    const ownerName = user ? user.name : "BEARER";
                    db.run("INSERT INTO vouchers (id, amount, user_id) VALUES (?,?,?)", [changeId, change, ownerId || null]);
                    printQueue.push(printer.generateVoucher({id: changeId, amount: change, user_name: ownerName}));
                    printQueue.push(printer.generateReceipt(cartItems, totalCost));
                    res.json({success:true, change, changeId, printWindow: printer.combinePrints(printQueue)});
                });
            } else {
                printQueue.push(printer.generateReceipt(cartItems, totalCost));
                res.json({success:true, change: 0, changeId: null, printWindow: printer.combinePrints(printQueue)});
            }
        });
    });
});

app.post('/api/mint', (req, res) => {
    const { amount, userId } = req.body;
    const vid = Math.random().toString(36).substring(2, 10).toUpperCase();
    db.get("SELECT name FROM users WHERE id=?", [userId], (e,u) => {
        db.run("INSERT INTO vouchers (id, amount, user_id) VALUES (?,?,?)", [vid, amount, userId], () => {
            const raw = printer.generateVoucher({id: vid, amount: amount, user_name: u ? u.name : null});
            res.json({success:true, printWindow: printer.combinePrints([raw])});
        });
    });
});

app.post('/api/payroll/process', (req, res) => {
    db.all(`SELECT t.user_id, u.name, SUM(t.total_hours) as hours, u.hourly_rate FROM timesheets t JOIN users u ON t.user_id = u.id WHERE t.is_paid = 0 AND t.clock_out IS NOT NULL GROUP BY t.user_id`, [], (err, rows) => {
        if(err || rows.length === 0) return res.json({success: true, count: 0});
        let printQueue = [];
        let completed = 0;
        rows.forEach(userPay => {
            const payAmount = userPay.hours * userPay.hourly_rate;
            const voucherId = Math.random().toString(36).substring(2, 10).toUpperCase();
            db.run("INSERT INTO vouchers (id, amount, user_id) VALUES (?, ?, ?)", [voucherId, payAmount, userPay.user_id], () => {
                db.run("UPDATE timesheets SET is_paid = 1 WHERE user_id = ? AND is_paid = 0 AND clock_out IS NOT NULL", [userPay.user_id], () => {
                    printQueue.push(printer.generateVoucher({ id: voucherId, amount: payAmount, user_name: userPay.name + " (PAYROLL)" }));
                    completed++;
                    if(completed === rows.length) {
                        res.json({ success: true, count: rows.length, printWindow: printer.combinePrints(printQueue) });
                    }
                });
            });
        });
    });
});

// --- HELPERS ---
app.get('/api/financials', (req, res) => {
    db.all("SELECT * FROM transactions ORDER BY created_at DESC", (err, transactions) => {
        if(err) return res.json([]);
        db.all("SELECT * FROM sales_log", (err, items) => {
            const report = transactions.map(t => ({ ...t, items: items.filter(i => i.transaction_id === t.id).map(i => i.item_name) }));
            res.json(report);
        });
    });
});

// --- ECONOMY STATS ---
// --- ECONOMY STATS & LATE WORK ---
app.get('/api/stats', (req, res) => {
    const stats = {};
    
    // 1. Get total vouchers issued and total money issued
    db.get("SELECT COUNT(*) as count, SUM(amount) as total_money FROM vouchers", [], (err, row) => {
        stats.totalVouchers = row ? row.count : 0;
        stats.totalMoney = row && row.total_money ? row.total_money : 0;
        
        // 2. Get top selling items
        db.all("SELECT item_name, COUNT(*) as count FROM sales_log GROUP BY item_name ORDER BY count DESC LIMIT 5", [], (err, rows) => {
            stats.topItems = rows || [];
            
            // 3. Get Pending Late Work count
            db.get("SELECT COUNT(*) as pending_count FROM late_work_tickets WHERE status = 'Pending'", [], (err, lateRow) => {
                stats.pendingLateWork = lateRow ? lateRow.pending_count : 0;
                res.json(stats);
            });
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

// --- BANK & TRANSFERS ---
app.post('/api/transfer', (req, res) => {
    const { senderId, receiverId, amount } = req.body;
    const transferAmount = parseFloat(amount);
    const fee = 5.00;
    const totalNeeded = transferAmount + fee;

    // Get all active vouchers for the sender
    db.all("SELECT * FROM vouchers WHERE user_id = ? AND is_used = 0", [senderId], (err, vouchers) => {
        const totalBalance = vouchers.reduce((sum, v) => sum + v.amount, 0);
        
        if (totalBalance < totalNeeded) {
            return res.status(400).json({error: "Insufficient funds (Transfer Amount + $5.00 Fee)."});
        }

        // Gather enough vouchers to cover the transfer + fee
        let sum = 0;
        let vouchersToUse = [];
        for (let v of vouchers) {
            sum += v.amount;
            vouchersToUse.push(v.id);
            if (sum >= totalNeeded) break;
        }

        const change = sum - totalNeeded;
        const placeholders = vouchersToUse.map(() => '?').join(',');

        // Mark gathered vouchers as used
        db.run(`UPDATE vouchers SET is_used = 1 WHERE id IN (${placeholders})`, vouchersToUse, () => {
            
            const receiverVoucherId = Math.random().toString(36).substring(2, 10).toUpperCase();
            
            db.get("SELECT name FROM users WHERE id=?", [receiverId], (err, receiver) => {
                // Mint transfer amount to receiver
                db.run("INSERT INTO vouchers (id, amount, user_id) VALUES (?,?,?)", [receiverVoucherId, transferAmount, receiverId]);
                
                let printQueue = [];
                printQueue.push(printer.generateVoucher({id: receiverVoucherId, amount: transferAmount, user_name: receiver ? receiver.name : "BEARER"}));

                // If sender overpaid, mint their change
                if (change > 0) {
                    const changeId = Math.random().toString(36).substring(2, 10).toUpperCase();
                    db.get("SELECT name FROM users WHERE id=?", [senderId], (err, sender) => {
                        db.run("INSERT INTO vouchers (id, amount, user_id) VALUES (?,?,?)", [changeId, change, senderId]);
                        printQueue.push(printer.generateVoucher({id: changeId, amount: change, user_name: sender ? sender.name : "BEARER"}));
                        
                        res.json({success: true, printWindow: printer.combinePrints(printQueue)});
                    });
                } else {
                    res.json({success: true, printWindow: printer.combinePrints(printQueue)});
                }
            });
        });
    });
});

app.post('/api/vouchers/:id/reprint', (req, res) => {
    const vid = req.params.id;
    db.get("SELECT v.*, u.name FROM vouchers v LEFT JOIN users u ON v.user_id = u.id WHERE v.id = ?", [vid], (err, v) => {
        if (!v) return res.status(404).json({error: "Voucher not found"});
        const raw = printer.generateVoucher({id: v.id, amount: v.amount, user_name: v.name || "BEARER"});
        res.json({success: true, printWindow: printer.combinePrints([raw])});
    });
});

// --- MESSAGING SYSTEM ---
app.get('/api/messages/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    db.get("SELECT role FROM users WHERE id=?", [userId], (err, user) => {
        if (!user) return res.status(401).json({error: "User not found"});
        
        // Join to get the sender's name
        let query = "SELECT m.*, s.name as sender_name FROM messages m LEFT JOIN users s ON m.sender_id = s.id ";
        let params = [];
        
        // If Admin, fetch EVERYTHING. If Employee, only fetch their DMs or Broadcasts (receiver_id = 0)
        if (user.role !== 'Admin') {
            query += "WHERE m.sender_id = ? OR m.receiver_id = ? OR m.receiver_id = 0 ";
            params = [userId, userId];
        }
        
        query += "ORDER BY m.timestamp ASC";
        
        db.all(query, params, (err, rows) => res.json(rows || []));
    });
});

app.post('/api/messages', (req, res) => {
    const { sender_id, receiver_id, message } = req.body;
    db.run("INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)", 
        [sender_id, receiver_id, message], function(err) {
        if(err) return res.status(500).json({error: err.message});
        res.json({success: true});
    });
});

// Legacy Printer Routes
app.get('/api/printers', (req, res) => { res.json([]); });
app.post('/api/printers', (req, res) => { res.json({success:true}); });
app.delete('/api/printers/:id', (req, res) => { res.json({success:true}); });
app.post('/api/printers/test', (req, res) => { res.json({success: true}); });

// --- LATE WORK TICKETS ---

// GET: Fetch all tickets (Admin view)
app.get('/api/late-work', (req, res) => {
    // Joins with the users table to get the name of the person who submitted it
    db.all("SELECT l.*, u.name as user_name FROM late_work_tickets l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.status DESC, l.created_at ASC", (err, rows) => {
        if(err) return res.status(500).json({error: err.message});
        res.json(rows || []);
    });
});

// POST: Create a new late work ticket
app.post('/api/late-work', (req, res) => {
    const { user_id, assignment_name } = req.body;
    db.run("INSERT INTO late_work_tickets (user_id, assignment_name) VALUES (?, ?)", [user_id, assignment_name], function(err) {
        if(err) return res.status(500).json({error: err.message});
        res.json({success: true, id: this.lastID});
    });
});

// PUT: Confirm a ticket (Changes status to 'Confirmed')
app.put('/api/late-work/:id/confirm', (req, res) => {
    db.run("UPDATE late_work_tickets SET status = 'Confirmed' WHERE id = ?", [req.params.id], (err) => {
        if(err) return res.status(500).json({error: err.message});
        res.json({success: true});
    });
});

// DELETE: Completely remove a ticket
app.delete('/api/late-work/:id', (req, res) => {
    db.run("DELETE FROM late_work_tickets WHERE id = ?", [req.params.id], (err) => {
        if(err) return res.status(500).json({error: err.message});
        res.json({success: true});
    });
});

app.listen(PORT, () => console.log(`System Online: http://localhost:${PORT}`));