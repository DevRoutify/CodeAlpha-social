# Gather Social

A mini social app built with HTML, CSS, JavaScript, Express, and SQLite. It includes profiles, a shared post feed, comments, likes, and follows.

## Run locally

1. Install Node.js (18 or newer).
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open [http://localhost:3000](http://localhost:3000).

SQLite creates `data/social.db` automatically and seeds three demo profiles the first time the app starts. Use the profile selector in the header to try actions as different users. There is no authentication in this demo.

## Deploy to Netlify

1. Push this project to your GitHub repository.
2. In Netlify, choose **Add new site → Import an existing project**, connect GitHub, and select the repository.
3. Keep the build settings from `netlify.toml` (`public` publish directory and `netlify/functions` functions directory), then deploy.

The Netlify function serves the Express API, while Netlify Blobs stores the SQLite database outside the temporary function filesystem. Local development continues to use `data/social.db`. The demo has no authentication and the SQLite snapshot storage is intended for low-traffic demos; use a hosted relational database for concurrent production traffic.

## API

- `GET /api/users` — list profiles
- `GET /api/users/:userId?viewerId=:viewerId` — profile, follow counts, and posts
- `POST /api/users/:userId/follow` — toggle follow (`{ "userId": 1 }`)
- `GET /api/feed?userId=:userId` — posts with comments and like state for viewer
- `POST /api/posts` — create a post (`{ "userId": 1, "content": "..." }`)
- `POST /api/posts/:postId/like` — toggle a like (`{ "userId": 1 }`)
- `POST /api/posts/:postId/comments` — add a comment (`{ "userId": 1, "content": "..." }`)
