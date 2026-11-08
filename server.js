const express = require("express");
const path = require("path");
const fs = require("fs");
const initSqlJs = require("sql.js");

const app = express();
const port = process.env.PORT || 3000;
let databasePath = path.join(__dirname, "data", "social.db");

let db;
let databaseInstance;

function persistDatabase() {
  fs.writeFileSync(databasePath, Buffer.from(databaseInstance.export()));
}

function createDatabaseAdapter(database) {
  return {
    exec: (sql) => database.exec(sql),
    prepare(sql) {
      return {
        get(...params) {
          const statement = database.prepare(sql);
          statement.bind(params);
          const row = statement.step() ? statement.getAsObject() : undefined;
          statement.free();
          return row;
        },
        all(...params) {
          const statement = database.prepare(sql);
          statement.bind(params);
          const rows = [];
          while (statement.step()) rows.push(statement.getAsObject());
          statement.free();
          return rows;
        },
        run(...params) {
          database.run(sql, params);
          const result = database.exec("SELECT last_insert_rowid() AS id");
          return { lastInsertRowid: result[0]?.values[0][0] ?? 0 };
        }
      };
    }
  };
}

async function initializeDatabase(options = {}) {
  if (options.databasePath) {
    databasePath = options.databasePath;
  }
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const SQL = await initSqlJs({
    locateFile: (filename) => path.join(process.cwd(), "node_modules", "sql.js", "dist", filename)
  });
  const database = fs.existsSync(databasePath)
    ? new SQL.Database(new Uint8Array(fs.readFileSync(databasePath)))
    : new SQL.Database();
  databaseInstance = database;
  db = createDatabaseAdapter(database);
  database.run("PRAGMA foreign_keys = ON");
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    bio TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, post_id)
  );
  CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, followed_id),
    CHECK (follower_id != followed_id)
  );
`);

  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (userCount === 0) {
    const addUser = db.prepare(
      "INSERT INTO users (name, username, bio, avatar) VALUES (?, ?, ?, ?)"
    );
    addUser.run("Maya Chen", "mayacreates", "Collecting little moments and big ideas.", "M");
    addUser.run("Alex Rivera", "alexrivera", "Designer, weekend hiker, and coffee enthusiast.", "A");
    addUser.run("Jordan Lee", "jordansays", "Making things, learning things, sharing things.", "J");
    const firstPost = db.prepare("INSERT INTO posts (user_id, content) VALUES (?, ?)");
    firstPost.run(1, "A little reminder to slow down and notice the good stuff around you. 🌿");
    firstPost.run(2, "Found a new favorite corner of the city this weekend. Already planning my next visit.");
    firstPost.run(3, "What’s one small thing that made your day better today?");
    db.prepare("INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)").run(1, 2);
    db.prepare("INSERT INTO likes (user_id, post_id) VALUES (?, ?)").run(2, 1);
    db.prepare("INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)").run(
      1, 2, "Needed this reminder today."
    );
  }
  persistDatabase();
}

function getDatabaseSnapshot() {
  return Buffer.from(databaseInstance.export());
}

app.use((req, _res, next) => {
  if (Buffer.isBuffer(req.body) && req.body.length && req.is("application/json")) {
    if (req.body.length > 20 * 1024) {
      return _res.status(413).json({ error: "Request body must be 20 KB or smaller." });
    }
    try {
      req.body = JSON.parse(req.body.toString("utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) {
        return _res.status(400).json({ error: "Request body must be valid JSON." });
      }
      return next(error);
    }
  }
  next();
});
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    const error = new Error(`${label} must be a positive integer.`);
    error.status = 400;
    throw error;
  }
  return id;
}

function requireUser(id) {
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) {
    const error = new Error("User not found.");
    error.status = 404;
    throw error;
  }
}

function boundedText(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(`${label} is required.`);
    error.status = 400;
    throw error;
  }
  const text = value.trim();
  if (text.length > maxLength) {
    const error = new Error(`${label} must be ${maxLength} characters or fewer.`);
    error.status = 400;
    throw error;
  }
  return text;
}

app.get("/api/users", (_req, res) => {
  const viewerId = _req.query.viewerId ? positiveId(_req.query.viewerId, "viewerId") : 0;
  if (viewerId) requireUser(viewerId);
  const users = db.prepare(`
    SELECT u.id, u.name, u.username, u.bio, u.avatar,
      (SELECT COUNT(*) FROM follows WHERE followed_id = u.id) AS followers_count,
      EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = u.id) AS followedByMe
    FROM users u ORDER BY u.id
  `).all(viewerId);
  for (const user of users) user.followedByMe = Boolean(user.followedByMe);
  res.json(users);
});

app.get("/api/feed", (req, res) => {
  const viewerId = positiveId(req.query.userId, "userId");
  requireUser(viewerId);
  const posts = db.prepare(`
    SELECT p.id, p.user_id AS userId, p.content, p.created_at AS createdAt,
      u.name, u.username, u.avatar,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likesCount,
      EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) AS likedByMe,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS commentsCount
    FROM posts p JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC, p.id DESC
  `).all(viewerId);
  const comments = db.prepare(`
    SELECT c.id, c.post_id AS postId, c.content, c.created_at AS createdAt,
      u.id AS userId, u.name, u.username, u.avatar
    FROM comments c JOIN users u ON u.id = c.user_id
    ORDER BY c.created_at, c.id
  `).all();
  const commentsByPost = new Map();
  for (const comment of comments) {
    if (!commentsByPost.has(comment.postId)) commentsByPost.set(comment.postId, []);
    commentsByPost.get(comment.postId).push(comment);
  }
  res.json(posts.map((post) => ({
    ...post,
    likedByMe: Boolean(post.likedByMe),
    comments: commentsByPost.get(post.id) || []
  })));
});

app.post("/api/posts", (req, res) => {
  const userId = positiveId(req.body.userId, "userId");
  requireUser(userId);
  const content = boundedText(req.body.content, "Post", 500);
  const result = db.prepare("INSERT INTO posts (user_id, content) VALUES (?, ?)").run(userId, content);
  persistDatabase();
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.post("/api/posts/:postId/like", (req, res) => {
  const postId = positiveId(req.params.postId, "postId");
  const userId = positiveId(req.body.userId, "userId");
  requireUser(userId);
  if (!db.prepare("SELECT id FROM posts WHERE id = ?").get(postId)) {
    return res.status(404).json({ error: "Post not found." });
  }
  const existing = db.prepare("SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?").get(userId, postId);
  if (existing) {
    db.prepare("DELETE FROM likes WHERE user_id = ? AND post_id = ?").run(userId, postId);
  } else {
    db.prepare("INSERT INTO likes (user_id, post_id) VALUES (?, ?)").run(userId, postId);
  }
  persistDatabase();
  const likesCount = db.prepare("SELECT COUNT(*) AS count FROM likes WHERE post_id = ?").get(postId).count;
  res.json({ liked: !existing, likesCount });
});

app.post("/api/posts/:postId/comments", (req, res) => {
  const postId = positiveId(req.params.postId, "postId");
  const userId = positiveId(req.body.userId, "userId");
  requireUser(userId);
  if (!db.prepare("SELECT id FROM posts WHERE id = ?").get(postId)) {
    return res.status(404).json({ error: "Post not found." });
  }
  const content = boundedText(req.body.content, "Comment", 280);
  const result = db.prepare(
    "INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)"
  ).run(postId, userId, content);
  persistDatabase();
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.get("/api/users/:userId", (req, res) => {
  const userId = positiveId(req.params.userId, "userId");
  const viewerId = positiveId(req.query.viewerId, "viewerId");
  requireUser(viewerId);
  const user = db.prepare(`
    SELECT u.id, u.name, u.username, u.bio, u.avatar,
      (SELECT COUNT(*) FROM follows WHERE followed_id = u.id) AS followersCount,
      (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) AS followingCount,
      EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = u.id) AS followedByMe
    FROM users u WHERE u.id = ?
  `).get(viewerId, userId);
  if (!user) return res.status(404).json({ error: "User not found." });
  const posts = db.prepare(`
    SELECT p.id, p.user_id AS userId, p.content, p.created_at AS createdAt,
      u.name, u.username, u.avatar,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likesCount,
      EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) AS likedByMe,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS commentsCount
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.user_id = ? ORDER BY p.created_at DESC, p.id DESC
  `).all(viewerId, userId);
  res.json({ ...user, followedByMe: Boolean(user.followedByMe), posts });
});

app.post("/api/users/:userId/follow", (req, res) => {
  const followedId = positiveId(req.params.userId, "userId");
  const followerId = positiveId(req.body.userId, "userId");
  requireUser(followerId);
  requireUser(followedId);
  if (followerId === followedId) {
    return res.status(400).json({ error: "You cannot follow yourself." });
  }
  const existing = db.prepare(
    "SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?"
  ).get(followerId, followedId);
  if (existing) {
    db.prepare("DELETE FROM follows WHERE follower_id = ? AND followed_id = ?").run(followerId, followedId);
  } else {
    db.prepare("INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)").run(followerId, followedId);
  }
  persistDatabase();
  const followersCount = db.prepare(
    "SELECT COUNT(*) AS count FROM follows WHERE followed_id = ?"
  ).get(followedId).count;
  res.json({ following: !existing, followersCount });
});

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  const status = error.status || 500;
  if (status === 500) console.error(error);
  res.status(status).json({ error: status === 500 ? "An unexpected server error occurred." : error.message });
});

if (require.main === module) {
  initializeDatabase().then(() => {
    app.listen(port, () => {
      console.log(`CodeAlpha Social is running at http://localhost:${port}`);
    });
  }).catch((error) => {
    console.error("Could not initialize the SQLite database.", error);
    process.exitCode = 1;
  });
}

module.exports = { app, getDatabaseSnapshot, initializeDatabase };
