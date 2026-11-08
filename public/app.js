const userSelect = document.querySelector("#user-select");
const feedElement = document.querySelector("#feed");
const peopleElement = document.querySelector("#people-list");
const profileElement = document.querySelector("#profile-card");
const noticeElement = document.querySelector("#notice");
const composerElement = document.querySelector("#composer");
const contentElement = document.querySelector("#post-content");
const composerAvatar = document.querySelector("#composer-avatar");

let users = [];
let currentUserId = Number(localStorage.getItem("gather-user-id")) || 1;
let activeProfileId = currentUserId;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function avatarClass(userId) {
  return `avatar-${((Number(userId) - 1) % 3) + 1}`;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong.");
  return result;
}

function showNotice(message = "") {
  noticeElement.textContent = message;
}

function timeAgo(dateValue) {
  const timestamp = new Date(`${dateValue.replace(" ", "T")}Z`).getTime();
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

function renderUsers() {
  userSelect.innerHTML = users.map((user) =>
    `<option value="${user.id}">${escapeHtml(user.name)}</option>`
  ).join("");
  if (!users.some((user) => user.id === currentUserId)) currentUserId = users[0]?.id;
  userSelect.value = String(currentUserId);
  localStorage.setItem("gather-user-id", String(currentUserId));
  const user = users.find((entry) => entry.id === currentUserId);
  composerAvatar.textContent = user?.avatar || "?";
  composerAvatar.className = `avatar avatar-large ${avatarClass(currentUserId)}`;
}

function renderPeople() {
  const suggestions = users.filter((user) => user.id !== currentUserId);
  peopleElement.innerHTML = suggestions.map((user) => `
    <div class="person-row">
      <div class="avatar ${avatarClass(user.id)}">${escapeHtml(user.avatar)}</div>
      <div class="person-info"><strong>${escapeHtml(user.name)}</strong><span>@${escapeHtml(user.username)}</span></div>
      <button class="text-button" type="button" data-follow="${user.id}" aria-label="${user.followedByMe ? "Unfollow" : "Follow"} ${escapeHtml(user.name)}">${user.followedByMe ? "Following" : "Follow"}</button>
    </div>
  `).join("");
}

function renderProfile(user) {
  profileElement.innerHTML = `
    <div class="profile-cover"></div>
    <div class="avatar ${avatarClass(user.id)}">${escapeHtml(user.avatar)}</div>
    <h2>${escapeHtml(user.name)}</h2>
    <div class="profile-handle">@${escapeHtml(user.username)}</div>
    <p class="profile-bio">${escapeHtml(user.bio)}</p>
    <div class="stats">
      <div class="stat"><strong>${user.followersCount}</strong><span>followers</span></div>
      <div class="stat"><strong>${user.followingCount}</strong><span>following</span></div>
    </div>
    ${user.id === currentUserId ? "" : `
      <button class="button ${user.followedByMe ? "button-secondary" : "button-primary"} profile-follow"
        type="button" data-follow="${user.id}">${user.followedByMe ? "Following" : "Follow"}</button>`}
  `;
}

function renderFeed(posts) {
  if (!posts.length) {
    feedElement.innerHTML = '<div class="empty-state">No moments here yet. Be the first to share one ✳</div>';
    return;
  }
  feedElement.innerHTML = posts.map((post) => `
    <article class="post-card card" data-post="${post.id}">
      <div class="post-header">
        <div class="avatar ${avatarClass(post.userId)}">${escapeHtml(post.avatar)}</div>
        <div class="post-author">
          <button type="button" data-profile="${post.userId}">${escapeHtml(post.name)}</button>
          <span>@${escapeHtml(post.username)}</span>
        </div>
        <time class="post-time">${escapeHtml(timeAgo(post.createdAt))}</time>
      </div>
      <p class="post-content">${escapeHtml(post.content)}</p>
      <div class="post-actions">
        <button class="action-button ${post.likedByMe ? "liked" : ""}" type="button" data-like="${post.id}" aria-label="${post.likedByMe ? "Unlike" : "Like"} post">
          <span class="heart">${post.likedByMe ? "♥" : "♡"}</span><span>${post.likesCount} ${post.likesCount === 1 ? "like" : "likes"}</span>
        </button>
        <span class="action-button"><span>☷</span><span>${post.commentsCount} ${post.commentsCount === 1 ? "comment" : "comments"}</span></span>
      </div>
      <div class="comments">
        ${post.comments.map((comment) => `
          <div class="comment"><strong>${escapeHtml(comment.name)}</strong>${escapeHtml(comment.content)}</div>
        `).join("")}
        <form class="comment-form" data-comment="${post.id}">
          <input name="content" maxlength="280" placeholder="Write a kind comment…" aria-label="Write a comment" required>
          <button type="submit">Reply</button>
        </form>
      </div>
    </article>
  `).join("");
}

async function refreshProfile() {
  const profile = await request(`/api/users/${activeProfileId}?viewerId=${currentUserId}`);
  renderProfile(profile);
}

async function refreshFeed() {
  const posts = await request(`/api/feed?userId=${currentUserId}`);
  renderFeed(posts);
}

async function refreshAll() {
  showNotice();
  try {
    users = await request(`/api/users?viewerId=${currentUserId}`);
    renderUsers();
    renderPeople();
    await Promise.all([refreshProfile(), refreshFeed()]);
  } catch (error) {
    showNotice(error.message);
  }
}

userSelect.addEventListener("change", async () => {
  currentUserId = Number(userSelect.value);
  activeProfileId = currentUserId;
  localStorage.setItem("gather-user-id", String(currentUserId));
  await refreshAll();
});

composerElement.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = contentElement.value.trim();
  if (!content) return;
  const submitButton = composerElement.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await request("/api/posts", {
      method: "POST",
      body: JSON.stringify({ userId: currentUserId, content })
    });
    contentElement.value = "";
    await refreshFeed();
  } catch (error) {
    showNotice(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const likeButton = event.target.closest("[data-like]");
  const followButton = event.target.closest("[data-follow]");
  const profileButton = event.target.closest("[data-profile]");
  try {
    if (likeButton) {
      await request(`/api/posts/${likeButton.dataset.like}/like`, {
        method: "POST", body: JSON.stringify({ userId: currentUserId })
      });
      await refreshFeed();
    } else if (followButton) {
      const targetId = Number(followButton.dataset.follow);
      await request(`/api/users/${targetId}/follow`, {
        method: "POST", body: JSON.stringify({ userId: currentUserId })
      });
      users = await request(`/api/users?viewerId=${currentUserId}`);
      renderPeople();
      await refreshProfile();
    } else if (profileButton) {
      const targetId = Number(profileButton.dataset.profile);
      activeProfileId = targetId;
      await refreshProfile();
    }
  } catch (error) {
    showNotice(error.message);
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest(".comment-form");
  if (!form) return;
  event.preventDefault();
  const content = new FormData(form).get("content").trim();
  if (!content) return;
  const submit = form.querySelector("button");
  submit.disabled = true;
  try {
    await request(`/api/posts/${form.dataset.comment}/comments`, {
      method: "POST", body: JSON.stringify({ userId: currentUserId, content })
    });
    await refreshFeed();
  } catch (error) {
    showNotice(error.message);
    submit.disabled = false;
  }
});

async function start() {
  try {
    users = await request("/api/users");
    if (!users.length) throw new Error("No profiles are available.");
    renderUsers();
    activeProfileId = currentUserId;
    await refreshAll();
  } catch (error) {
    showNotice(error.message);
  }
}

start();
