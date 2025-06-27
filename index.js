const express = require('express');
const path = require('path');
const app = express();
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const session = require('express-session');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
dotenv.config();

const connection = mysql.createConnection({
    host : process.env.DB_HOST,
    user : process.env.DB_USER,
    password : process.env.SQL_PASS,
    database : process.env.DB_NAME
});  

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,      
    pass: process.env.EMAIL_PASS 
  }
});

app.use(session({
  secret: process.env.SECRET_KEY,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 }
}));


app.use(express.json());
app.use(express.urlencoded({extended : true}));
app.use(express.static(path.join(__dirname,'public')));
app.set('view engine', 'ejs');

function sendMail(to, subject, html){
  const mailOptions = {
    from: 'Credenzo.banking credenzo.banking@gmail.com',
    to,
    subject,
    html 
  }
  return transporter.sendMail(mailOptions);
};

module.exports = sendMail;

//homepage
app.get('/', (req, res) => {
    res.render('index.ejs');
});

//login page
app.get('/login',(req, res) => {
    const error = req.query.error;
    const otp = req.query.otp;
    res.render('loginpage.ejs', { otp, error });
});

//877229676496 admin

//now redirecting to another route for login
app.post('/login-success', async (req, res) => {
  const { accnum, pin, otp } = req.body;

  // PHASE 1: PIN stage (no OTP yet)
  if (!otp) {
    const sql = `SELECT * FROM users WHERE acc_num = ?`;
    connection.query(sql, [accnum], async (err, results) => {
      if (err) {
        console.log(err);
        return res.redirect('/login?error=Something+Went+Wrong!');
      }

      if (results.length === 0) {
        return res.redirect('/login?error=Account+Not+Found.');
      }

      const user = results[0];
      const pinMatch = await bcrypt.compare(pin, user.pinhash);
      if (!pinMatch) return res.redirect('/login?error=Incorrect+PIN');

      // Store temp user session and send OTP
      req.session.tempUser = user;
      const generatedOTP = Math.floor(100000 + Math.random() * 900000);
      req.session.otp = generatedOTP;

      sendMail(user.email, "Credenzo Login OTP", `
        Dear ${user.fullname},<br>
        Your OTP for login is:<h2>${generatedOTP}</h2><br>
        It is valid for 3 minutes.<br><br>${footer}
      `).then(() => {
        return res.redirect('/login-success?otp=true');
      }).catch((e) => {
        console.error(e);
        return res.redirect("/login?error=OTP+sending+failed");
      });
    });

  } else {
    // PHASE 2: OTP verification stage
    if (!req.session.otp || !req.session.tempUser) {
      return res.redirect("/login?error=Session+expired");
    }

    if (parseInt(otp) === req.session.otp) {
      const user = req.session.tempUser;

      req.session.user = {
        fullname: user.fullname,
        acc_num: user.acc_num,
        role: user.role
      };

      delete req.session.otp;
      delete req.session.tempUser;

      if (user.role === 'user') {
        return res.redirect(`/dashboard/${encodeURIComponent(user.fullname)}`);
      } else {
        return res.redirect('/admin-dashboard');
      }
    } else {
      return res.redirect("/login?error=Invalid+OTP");
    }
  }
});


app.get('/login-success', (req, res) => {
  if (!req.session.tempUser) {
    return res.redirect('/login?error=Session+expired,+please+login+again');
  }

  res.render('loginpage', { otp: true, error: null });
});



//dashboard page
app.get('/dashboard/:fullname', (req, res) => {
    if(!req.session.user | req.session.user.role !== 'user'){
        res.redirect('/login');
    }

    const accNo = req.session.user.acc_num;
    const flash = req.session.flash;
    delete req.session.flash;

    connection.query('SELECT * FROM users WHERE acc_num = ?', [accNo], (err, result) => {
    if (err || result.length === 0) return res.status(404).send("User not found");

    const user = result[0];

    connection.query('SELECT * FROM transactions WHERE acc_num = ? ORDER BY timestamp DESC', [accNo], (err, txResult) => {
      if (err) return res.status(500).send("Server Error: Transaction fetch failed");

      res.render('dashboardUser', {
        fullname: user.fullname,
        acc_num: user.acc_num,
        balance: user.balance,
        transactions: txResult,
        flashMsg: flash
      });
    });
  });
});

//withdraw logic for users
app.post('/withdraw', (req, res) => {
  const { account, amount, pin } = req.body;
  const amt = parseFloat(amount);

  if (!req.session.user || req.session.user.acc_num !== account) {
    req.session.flash = { type: 'error', msg: 'Unauthorized access!' };
    return res.redirect('/login');
  }

  connection.query('SELECT * FROM users WHERE acc_num = ?', [account],async (err, result) => {
    if (err || result.length === 0){ 
      req.session.flash = { type: 'error', msg: '❌ Account not found' };
      return res.redirect(`/dashboard/${encodeURIComponent(req.session.user.fullname)}`);
    }

    const user = result[0];
    const pinMatch = await bcrypt.compare(pin, user.pinhash);

    if (!pinMatch) {
      req.session.flash = { type: 'error', msg: '❌ Incorrect PIN' };
      return res.redirect(`/dashboard/${encodeURIComponent(req.session.user.fullname)}`);
    }

    if (user.balance < amt) {
      req.session.flash = { type: 'error', msg: '❌ Insufficient balance' };
      return res.redirect(`/dashboard/${encodeURIComponent(req.session.user.fullname)}`);
    }

    const newBalance = user.balance - amt;

    connection.query('UPDATE users SET balance = ? WHERE acc_num = ?', [newBalance, account], (err) => {
      if (err){
        req.session.flash = { type: 'error', msg: '❌ Failed to update balance' };
        return res.redirect(`/dashboard/${encodeURIComponent(req.session.user.fullname)}`);
      }

      const txQuery = `
        INSERT INTO transactions (acc_num, type, amount, description, balance_after)
        VALUES (?, 'withdrawal', ?, 'User withdrawal', ?)
      `;

      connection.query(txQuery, [account, amt, newBalance], (err) => {
        if (err) {
          req.session.flash = { type: 'error', msg: '❌ Failed to log transaction' };
        } 
        else {
          req.session.flash = {
            type: 'success',
            msg: `✅ ₹${amt} withdrawn successfully!`
          };
        }

        res.redirect(`/dashboard/${encodeURIComponent(req.session.user.fullname)}`);
      });
    });
  });
});


//transfer logic for users
app.post('/transfer', (req, res) => {
  const { sender, receiver, amount, description } = req.body;
  const amt = parseFloat(amount);

  if (!req.session.user || req.session.user.acc_num !== sender) {
    return res.redirect('/login');
  }

  if (sender === receiver) return res.send("Sender and receiver cannot be the same");

  connection.query('SELECT * FROM users WHERE acc_num = ?', [sender], (err, senderRes) => {
    if (err || senderRes.length === 0) return res.send("Sender not found");
    if (senderRes[0].balance < amt) return res.send("Insufficient balance");

    connection.query('SELECT * FROM users WHERE acc_num = ?', [receiver], (err, receiverRes) => {
      if (err || receiverRes.length === 0) return res.send("Receiver not found");

      const senderNew = senderRes[0].balance - amt;
      const receiverNew = receiverRes[0].balance + amt;

      connection.query('UPDATE users SET balance = ? WHERE acc_num = ?', [senderNew, sender], (err) => {
        if (err) return res.send("Failed to update sender balance");

        connection.query('UPDATE users SET balance = ? WHERE acc_num = ?', [receiverNew, receiver], (err) => {
          if (err) return res.send("Failed to update receiver balance");

          const txQuery = `
            INSERT INTO transactions
            (acc_num, type, amount, description, balance_after, receiver_account_number)
            VALUES (?, ?, ?, ?, ?, ?)
          `;

          connection.query(txQuery, [sender, 'transfer', amt, description || 'Sent to ' + receiver, senderNew, receiver], (err) => {
            if (err) return res.send("Failed to log sender tx");

            connection.query(txQuery, [receiver, 'deposit', amt, 'Received from ' + sender, receiverNew, sender], (err) => {
              if (err) return res.send("Failed to log receiver tx");

              res.redirect(`/dashboard/${encodeURIComponent(req.session.user.fullname)}`);
            });
          });
        });
      });
    });
  });
});


//admin dashboard
app.get('/admin-dashboard', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }

    const flash = req.session.flash;
    delete req.session.flash;

  // Fetch all user accounts
  const usersQuery = `
    SELECT fullname, acc_num, balance, role, DOB, addr, phn_num
    FROM users
    WHERE role = 'user'
  `;

    connection.query(usersQuery, (err, usersResult) => {
    if (err) return res.status(500).send("Failed to fetch users");

    const totalUsers = usersResult.length;

    // Fetch all transactions
    const transactionsQuery = `
      SELECT * FROM transactions
      ORDER BY timestamp DESC
    `;

    connection.query(transactionsQuery, (err, txResult) => {
      if (err) return res.status(500).send("Failed to fetch transactions");

      const totalTransactions = txResult.length;

      // (Optional) Get total balance across all users
      const balanceQuery = `SELECT SUM(balance) AS totalBalance FROM users WHERE role = 'user'`;

      connection.query(balanceQuery, (err, balanceRes) => {
        if (err) return res.status(500).send("Failed to fetch total balance");

        const totalBalance = balanceRes[0].totalBalance || 0;

        res.render('adminDashboard', {
          adminName: req.session.user.fullname,
          users: usersResult,
          transactions: txResult,
          totalUsers,
          totalTransactions,
          totalBalance,
          flashMsg: flash
        });
      });
    });
  });
});


//Admin-transfer Money logic with a new route
app.post('/admin-transfer', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }

  const { receiver, amount, description } = req.body;
  const amt = parseFloat(amount);

  if (amt <= 0) return res.send("Amount must be positive");

  // Step 1: Get the receiver
  connection.query('SELECT * FROM users WHERE acc_num = ?', [receiver], (err, receiverRes) => {
    if (err || receiverRes.length === 0) return res.send("Receiver account not found");

    const newBalance = receiverRes[0].balance + amt;

    // Step 2: Update receiver's balance
    connection.query(
      'UPDATE users SET balance = ? WHERE acc_num = ?',
      [newBalance, receiver],
      (err) => {
        if (err) return res.send("Failed to update receiver balance");

        // Step 3: Log transaction (admin transfer)
        const txQuery = `
          INSERT INTO transactions
          (acc_num, type, amount, description, balance_after, receiver_account_number)
          VALUES (?, 'deposit', ?, ?, ?, ?)
        `;

        connection.query(
          txQuery,
          [receiver, amount, description || 'Fund credited by Admin', newBalance, receiver],
          (err) => {
            if (err) return res.send(err,"Failed to log transaction");
    
            req.session.flash = `✅ ₹${amount} successfully transferred to A/C ${receiver}`;
            res.redirect('/admin-dashboard');
          }
        );
      }
    );
  });
});


app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.send("Logout error");
    res.redirect('/login');
  });
});


//create acc page
app.get('/create-acc',(req, res) => {
    res.render('createAcc.ejs');
});

//creating a account and sending it to database
app.post('/created-acc',async (req, res) => {
    const {fullname, age, dob, email, phn, addr, pin} = req.body;

    const acc_num = String(Math.floor(100000000000 + Math.random()* 900000000000));
    const pinhash = await bcrypt.hash(pin, 10);

    const sql = 'INSERT INTO users (fullname, acc_num, age, dob, email, addr, phn_num, pinhash) VALUES (?, ?, ?, ?, ?, ?, ?, ?);';
    const values = [fullname, acc_num, age, dob, email, addr,phn , pinhash];
    connection.query(sql, values, (err)=>{
        if (err) {
            console.log('DB error', err);
            return res.send('DB error');
        }
    });
    sendMail(email, "Welcome to Credenzo Bank 💙", `
      Dear ${fullname},<br><br>
      Welcome to <b>Credenzo</b> - your secure and smart digital banking partner.<br>
      Your account number is: <h2>${acc_num}</h2><br>
      Please, keep this account number in a safe location. 
      Also in the future you will be contacted through this email ID for verification purposes
      <br><br>
      Thank you for joining us! <br><br>
      - Credenzo Team <br>
      <b>Note:</b> This is a system generated email and do NOT reply to it. <br><br>
      ${footer}
    `).then(() => {
      console.log("Welcome email sent!");
    }).catch((err) => {
      console.error("Email failed:", err);
    });

        res.render('createdAcc.ejs',{fullname, acc_num});
    });


//hosting the website
app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});


const footer = `
  <div style="background-color: #0B1D3A; padding: 10px 60px 10px; border-radius: 10px; width: max-content; color: #fff; font-family: 'Gill Sans MT';" >
      <strong style="font-size: 25px;">Credenzo💙2025</strong><br>
      Contact us at:<a href="credenzo.banking@gmail.com"> credenzo.banking@gmail.com</a><br>
      All rights reserved Credenzo © 2025
  </div>
`;