const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// On Render, use the persistent disk at /data so data survives re-deploys.
// Locally, fall back to a data.json file in the project folder.
const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// ─── DATA LAYER ───
function getDefaultData() {
  const d = (offset) => {
    const dt = new Date();
    dt.setDate(dt.getDate() + offset);
    return dt.toISOString().slice(0, 10);
  };
  return {
    tasks: [
      { id: uuidv4(), title: 'Finalize Q2 marketing strategy', desc: 'Review targets and align with sales team goals.', assignee: 'Sarah', status: 'in-progress', priority: 'high', due: d(2), category: 'Marketing', comments: [{ id: uuidv4(), author: 'Phillip', text: "Let's sync on this Monday.", time: d(-1) }], created: d(-3) },
      { id: uuidv4(), title: 'Update API documentation', desc: 'Add new endpoints from v2.3 release.', assignee: 'Dev', status: 'todo', priority: 'medium', due: d(4), category: 'Backend', comments: [], created: d(-2) },
      { id: uuidv4(), title: 'Design homepage mockups', desc: 'Create 3 variations for A/B testing.', assignee: 'Anya', status: 'in-progress', priority: 'high', due: d(1), category: 'Design', comments: [{ id: uuidv4(), author: 'Marcus', text: 'Check the brand guidelines doc.', time: d(-1) }], created: d(-5) },
      { id: uuidv4(), title: 'Fix login timeout bug', desc: 'Users report being logged out after 5 mins.', assignee: 'James', status: 'blocked', priority: 'high', due: d(-1), category: 'Backend', comments: [{ id: uuidv4(), author: 'James', text: 'Need access to prod logs.', time: d(0) }], created: d(-4) },
      { id: uuidv4(), title: 'Prepare client presentation', desc: "Deck for Thursday's stakeholder meeting.", assignee: 'Phillip', status: 'todo', priority: 'high', due: d(3), category: 'Management', comments: [], created: d(-1) },
      { id: uuidv4(), title: 'Onboard new team members', desc: 'Set up accounts, tools and schedule intro calls.', assignee: 'Olivia', status: 'todo', priority: 'medium', due: d(5), category: 'HR', comments: [], created: d(-1) },
      { id: uuidv4(), title: 'Run performance benchmarks', desc: 'Compare current vs previous release.', assignee: 'Dev', status: 'done', priority: 'low', due: d(-2), category: 'Backend', comments: [{ id: uuidv4(), author: 'Dev', text: 'Results posted in #engineering.', time: d(-1) }], created: d(-7) },
      { id: uuidv4(), title: 'Review competitor analysis', desc: 'Summarize findings from market research.', assignee: 'Priya', status: 'todo', priority: 'medium', due: d(6), category: 'Marketing', comments: [], created: d(0) },
    ],
    members: ['Phillip', 'Catherine', 'Liberty', 'Gail', 'Gil', 'Lisa', 'Jules', 'Donna', 'Barbi', 'Cathy'],
    activityLog: [],
    passwords: {}  // { memberName: hashedPassword } — empty until each user sets theirs on first login
  };
}

// ─── PASSWORD HELPERS ───
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading data:', e.message);
  }
  const data = getDefaultData();
  saveData(data);
  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

// ─── MIDDLEWARE ───
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── REST API ───

// Get all data (don't expose passwords)
app.get('/api/state', (req, res) => {
  res.json({ tasks: data.tasks, members: data.members });
});

// Check if a member has set a password yet
app.get('/api/auth/status/:name', (req, res) => {
  const name = req.params.name;
  if (!data.passwords) data.passwords = {};
  const hasPassword = !!data.passwords[name];
  res.json({ hasPassword });
});

// Set password (first-time login only)
app.post('/api/auth/register', (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Name and password are required' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  if (!data.passwords) data.passwords = {};
  if (data.passwords[name]) return res.status(400).json({ error: 'Password already set. Use login instead.' });
  data.passwords[name] = hashPassword(password);
  saveData(data);
  res.json({ success: true });
});

// Login with existing password
app.post('/api/auth/login', (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Name and password are required' });
  if (!data.passwords) data.passwords = {};
  if (!data.passwords[name]) return res.status(400).json({ error: 'No password set. Please set one first.' });
  if (data.passwords[name] !== hashPassword(password)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  res.json({ success: true });
});

// Register a new member (with password)
app.post('/api/auth/register-new', (req, res) => {
  const { name, password } = req.body;
  if (!name?.trim() || !password) return res.status(400).json({ error: 'Name and password are required' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  if (data.members.includes(name.trim())) return res.status(400).json({ error: 'Name already taken' });
  if (!data.passwords) data.passwords = {};
  data.members.push(name.trim());
  data.passwords[name.trim()] = hashPassword(password);
  saveData(data);
  io.emit('member:added', name.trim());
  res.status(201).json({ success: true });
});

// Create task
app.post('/api/tasks', (req, res) => {
  const task = {
    id: uuidv4(),
    title: req.body.title,
    desc: req.body.desc || '',
    assignee: req.body.assignee,
    status: req.body.status || 'todo',
    priority: req.body.priority || 'medium',
    due: req.body.due || '',
    category: req.body.category || '',
    comments: [],
    created: new Date().toISOString().slice(0, 10)
  };
  data.tasks.push(task);
  logActivity(req.body._user || 'Unknown', 'created', task.title);
  saveData(data);
  io.emit('task:created', task);
  res.status(201).json(task);
});

// Update task
app.put('/api/tasks/:id', (req, res) => {
  const idx = data.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const old = { ...data.tasks[idx] };
  Object.assign(data.tasks[idx], req.body);
  delete data.tasks[idx]._user;
  logActivity(req.body._user || 'Unknown', 'updated', data.tasks[idx].title);
  saveData(data);
  io.emit('task:updated', data.tasks[idx]);
  res.json(data.tasks[idx]);
});

// Delete task
app.delete('/api/tasks/:id', (req, res) => {
  const idx = data.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const removed = data.tasks.splice(idx, 1)[0];
  logActivity(req.query.user || 'Unknown', 'deleted', removed.title);
  saveData(data);
  io.emit('task:deleted', { id: req.params.id });
  res.json({ success: true });
});

// Add comment
app.post('/api/tasks/:id/comments', (req, res) => {
  const task = data.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const comment = {
    id: uuidv4(),
    author: req.body.author,
    text: req.body.text,
    time: new Date().toISOString().slice(0, 10)
  };
  task.comments.push(comment);
  logActivity(comment.author, 'commented on', task.title);
  saveData(data);
  io.emit('comment:added', { taskId: task.id, comment });
  res.status(201).json(comment);
});

// Add member
app.post('/api/members', (req, res) => {
  const name = req.body.name?.trim();
  if (!name || data.members.includes(name)) return res.status(400).json({ error: 'Invalid or duplicate' });
  data.members.push(name);
  saveData(data);
  io.emit('member:added', name);
  res.status(201).json({ name });
});

// Activity log
app.get('/api/activity', (req, res) => {
  res.json(data.activityLog?.slice(-50) || []);
});

function logActivity(user, action, target) {
  if (!data.activityLog) data.activityLog = [];
  data.activityLog.push({ user, action, target, time: new Date().toISOString() });
  if (data.activityLog.length > 200) data.activityLog = data.activityLog.slice(-100);
  io.emit('activity', { user, action, target, time: new Date().toISOString() });
}

// ─── WEBSOCKET ───
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('user:join', (username) => {
    onlineUsers.set(socket.id, username);
    io.emit('users:online', [...new Set(onlineUsers.values())]);
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('users:online', [...new Set(onlineUsers.values())]);
    console.log(`User disconnected: ${socket.id}`);
  });

  // Real-time typing indicator
  socket.on('user:typing', (data) => {
    socket.broadcast.emit('user:typing', data);
  });
});

// ─── START ───
server.listen(PORT, () => {
  console.log(`\n  ⚡ TeamFlow is running at http://localhost:${PORT}\n`);
  console.log(`  Share this URL with your team on the same network.`);
  console.log(`  For external access, deploy to Render or Railway.\n`);
});
