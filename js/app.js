/**
 * KraussMaffei Comment Page – a threaded comments page.
 *
 * Everything runs in the browser: users and comments are kept in Web Storage
 * and every new comment is checked for inappropriate words in a Web Worker
 * (see moderation.worker.js).
 *
 * Contents:
 *   1. Configuration
 *   2. Storage helpers
 *   3. Authentication
 *   4. Comments
 *   5. Moderation
 *   6. Rendering
 *   7. Event handlers
 *   8. Start
 *   9. Easter egg
 */

// ===========================================================================
// 1. Configuration
// ===========================================================================

/** Keys used in Web Storage. The prefix avoids clashes with other pages on the same domain. */
const STORAGE_KEYS = {
  users: 'kmcp.users',       // localStorage – survives a browser restart
  session: 'kmcp.session',   // sessionStorage – ends when the tab is closed
  comments: 'kmcp.comments', // localStorage
};

/** 3–20 letters, digits, dots, underscores or hyphens. */
const USERNAME_PATTERN = /^[\p{L}\d._-]{3,20}$/u;
/** Kept short on purpose – this is a demo without real accounts. */
const MIN_PASSWORD_LENGTH = 4;

/** Resolved relative to this file, so it works in any sub-folder (e.g. GitHub Pages). */
const MODERATION_WORKER_URL = new URL('./moderation.worker.js', import.meta.url);

/** All DOM elements the script works with, looked up once. */
const elements = {
  guestHint: document.querySelector('#guest-hint'),
  userPanel: document.querySelector('#user-panel'),
  authForm: document.querySelector('#auth-form'),
  currentUsername: document.querySelector('#current-username'),
  logoutButton: document.querySelector('#logout-button'),
  newCommentSlot: document.querySelector('#new-comment-slot'),
  emptyState: document.querySelector('#empty-state'),
  commentList: document.querySelector('#comment-list'),
  commentTemplate: document.querySelector('#comment-template'),
  commentFormTemplate: document.querySelector('#comment-form-template'),
};

/** Formats timestamps in the user's own language, e.g. "8 Oct 2026, 9:30". */
const timestampFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
/** Joins words into a sentence list, e.g. '"Putin" and "War"'. */
const wordList = new Intl.ListFormat('en', { type: 'conjunction' });

// ===========================================================================
// 2. Storage helpers
//    Web Storage can only hold strings, so values are stored as JSON.
// ===========================================================================

/**
 * Reads and parses a JSON value. Returns `fallback` when the key is
 * missing or the stored value is not valid JSON.
 *
 * @template T
 * @param {Storage} storage localStorage or sessionStorage
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
function readJson(storage, key, fallback) {
  const raw = storage.getItem(key);

  if (raw === null) {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {Storage} storage
 * @param {string} key
 * @param {unknown} value
 */
function writeJson(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

// ===========================================================================
// 3. Authentication
//    Passwords are stored only as salted SHA-256 hashes.
//
//    NOTE: this is a demo without a backend, as required by the assignment.
//    Anything stored in the browser can be read and modified by its user,
//    so this must not be used as real security.
// ===========================================================================

/**
 * @typedef {object} StoredUser
 * @property {string} username
 * @property {string} salt
 * @property {string} passwordHash
 */

/** Error with a message that is safe to show to the user. */
class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Creates a new account and logs the user in.
 *
 * @param {string} username
 * @param {string} password
 */
async function register(username, password) {
  const name = username.trim();

  if (!USERNAME_PATTERN.test(name)) {
    throw new AuthError('Username must have 3–20 characters (letters, numbers, ".", "_" or "-").');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Password must have at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const users = getUsers();
  if (findUser(users, name)) {
    throw new AuthError('This username is already taken.');
  }

  const salt = createSalt();
  const passwordHash = await hashPassword(password, salt);
  writeJson(localStorage, STORAGE_KEYS.users, [...users, { username: name, salt, passwordHash }]);

  startSession(name);
}

/**
 * @param {string} username
 * @param {string} password
 */
async function login(username, password) {
  const user = findUser(getUsers(), username.trim());
  const passwordHash = user ? await hashPassword(password, user.salt) : null;

  // The same message for both cases, so the form does not reveal which usernames exist.
  if (!user || passwordHash !== user.passwordHash) {
    throw new AuthError('Incorrect username or password.');
  }

  startSession(user.username);
}

/** Ends the session; the account itself stays stored. */
function logout() {
  sessionStorage.removeItem(STORAGE_KEYS.session);
}

/** @returns {string | null} the logged in username, or null for a guest */
function getCurrentUser() {
  return sessionStorage.getItem(STORAGE_KEYS.session);
}

/** @param {string} username */
function startSession(username) {
  sessionStorage.setItem(STORAGE_KEYS.session, username);
}

/** @returns {StoredUser[]} */
function getUsers() {
  return readJson(localStorage, STORAGE_KEYS.users, []);
}

/** Usernames are unique regardless of letter case. */
function findUser(users, username) {
  const wanted = username.toLowerCase();
  return users.find((user) => user.username.toLowerCase() === wanted);
}

/** @returns {string} 16 random bytes as hex, unique for every user */
function createSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Hashes the password together with the salt (SHA-256, Web Crypto API).
 *
 * @param {string} password
 * @param {string} salt
 * @returns {Promise<string>} hex string
 */
async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

/**
 * @param {Uint8Array} bytes
 * @returns {string} e.g. [255, 1] -> "ff01"
 */
function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ===========================================================================
// 4. Comments
//    Comments are stored as a flat list. Each comment points to its parent
//    through `parentId` (null = top-level comment), which is enough to
//    rebuild the whole tree. A reply at any depth is saved by appending
//    a single item.
// ===========================================================================

/**
 * @typedef {object} Comment
 * @property {string} id
 * @property {string | null} parentId
 * @property {string} author
 * @property {string} text
 * @property {string} createdAt ISO 8601 timestamp
 */

/** @returns {Comment[]} all comments in the order they were added */
function getComments() {
  return readJson(localStorage, STORAGE_KEYS.comments, []);
}

/**
 * Saves a comment with the current timestamp.
 *
 * @param {{ parentId: string | null, author: string, text: string }} input
 * @returns {Comment}
 */
function addComment({ parentId, author, text }) {
  const comments = getComments();

  if (parentId !== null && !comments.some((comment) => comment.id === parentId)) {
    throw new Error(`Parent comment "${parentId}" does not exist.`);
  }

  const comment = {
    id: crypto.randomUUID(),
    parentId,
    author,
    text,
    createdAt: new Date().toISOString(),
  };

  writeJson(localStorage, STORAGE_KEYS.comments, [...comments, comment]);
  return comment;
}

/**
 * Groups comments by their parent, so the children of any node can be
 * looked up directly while rendering the tree.
 *
 * @param {Comment[]} comments
 * @returns {Map<string | null, Comment[]>}
 */
function groupByParent(comments) {
  const childrenByParent = new Map();

  for (const comment of comments) {
    const siblings = childrenByParent.get(comment.parentId) ?? [];
    siblings.push(comment);
    childrenByParent.set(comment.parentId, siblings);
  }

  return childrenByParent;
}

// ===========================================================================
// 5. Moderation
//    Every check starts a new worker (as the assignment requires) and
//    terminates it as soon as the answer arrives.
// ===========================================================================

/**
 * @param {string} text comment text
 * @returns {Promise<string[]>} the inappropriate words found in the text
 */
function checkComment(text) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(MODERATION_WORKER_URL, { type: 'module' });

    worker.addEventListener('message', ({ data }) => {
      worker.terminate();

      if (data.status === 'ok') {
        resolve(data.foundWords);
      } else {
        reject(new Error(data.message));
      }
    });

    worker.addEventListener('error', (event) => {
      worker.terminate();
      reject(new Error(event.message || 'The moderation worker failed to start.'));
    });

    worker.postMessage({ text });
  });
}

/**
 * @param {string[]} words
 * @returns {string} e.g. 'You cannot use the words "Russia" and "War" in your comment.'
 */
function createBlockedMessage(words) {
  const quoted = wordList.format(words.map((word) => `"${word}"`));
  const noun = words.length === 1 ? 'word' : 'words';
  return `You cannot use the ${noun} ${quoted} in your comment.`;
}

// ===========================================================================
// 6. Rendering
//    Elements are cloned from <template> tags in index.html. User content is
//    always inserted with `textContent`, never as HTML, so a comment like
//    "<script>…</script>" is displayed as plain text (no XSS).
// ===========================================================================

/** Re-renders everything that depends on the login state or the comments. */
function render() {
  const username = getCurrentUser();
  const isLoggedIn = username !== null;
  const comments = getComments();

  elements.authForm.hidden = isLoggedIn;
  elements.guestHint.hidden = isLoggedIn;
  elements.userPanel.hidden = !isLoggedIn;
  elements.currentUsername.textContent = username ?? '';
  newCommentForm.hidden = !isLoggedIn;

  elements.emptyState.hidden = comments.length > 0;
  renderCommentTree(comments, isLoggedIn);
}

/**
 * Renders the comment tree. `renderBranch` is recursive: it renders the
 * children of one parent and calls itself for each of them.
 *
 * @param {Comment[]} comments
 * @param {boolean} canReply
 */
function renderCommentTree(comments, canReply) {
  const childrenByParent = groupByParent(comments);

  const renderBranch = (parentId) => (childrenByParent.get(parentId) ?? []).map((comment) => {
    const element = createCommentElement(comment, canReply);
    element.querySelector('.comment-list--nested').append(...renderBranch(comment.id));
    return element;
  });

  elements.commentList.replaceChildren(...renderBranch(null));
}

/**
 * @param {Comment} comment
 * @param {boolean} canReply
 * @returns {HTMLLIElement}
 */
function createCommentElement(comment, canReply) {
  const element = elements.commentTemplate.content.firstElementChild.cloneNode(true);
  const time = element.querySelector('.comment__time');
  const replyButton = element.querySelector('.button--reply');
  const replySlot = element.querySelector('.comment__reply-slot');

  element.querySelector('.comment__author').textContent = comment.author;
  element.querySelector('.comment__text').textContent = comment.text;
  time.dateTime = comment.createdAt;
  time.textContent = timestampFormat.format(new Date(comment.createdAt));

  replyButton.hidden = !canReply;
  replyButton.addEventListener('click', () => toggleReplyForm(comment.id, replyButton, replySlot));

  return element;
}

/**
 * Opens a reply form under the comment, or closes it when it is already open.
 *
 * @param {string} parentId
 * @param {HTMLButtonElement} replyButton
 * @param {HTMLElement} replySlot
 */
function toggleReplyForm(parentId, replyButton, replySlot) {
  const closeForm = () => {
    replySlot.replaceChildren();
    replyButton.setAttribute('aria-expanded', 'false');
  };

  if (replySlot.hasChildNodes()) {
    closeForm();
    return;
  }

  const form = createCommentForm({
    onSubmit: (replyForm) => submitComment(replyForm, parentId),
    onCancel: closeForm,
  });

  replySlot.append(form);
  replyButton.setAttribute('aria-expanded', 'true');
  form.elements.text.focus();
}

/**
 * Creates a comment form. Used for new top-level comments and for replies.
 *
 * @param {{ onSubmit: (form: HTMLFormElement) => void, onCancel?: () => void }} handlers
 * @returns {HTMLFormElement}
 */
function createCommentForm({ onSubmit, onCancel }) {
  const form = elements.commentFormTemplate.content.firstElementChild.cloneNode(true);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onSubmit(form);
  });

  if (onCancel) {
    const cancelButton = form.querySelector('[data-action="cancel"]');
    cancelButton.hidden = false;
    cancelButton.addEventListener('click', onCancel);
  }

  return form;
}

/**
 * @param {HTMLFormElement} form
 * @param {string} text empty string hides the message
 */
function showFormMessage(form, text) {
  form.querySelector('[data-message]').textContent = text;
}

/**
 * Disables the form while it is being processed, so it cannot be sent twice.
 *
 * @param {HTMLFormElement} form
 * @param {boolean} isBusy
 */
function setFormBusy(form, isBusy) {
  form.setAttribute('aria-busy', String(isBusy));

  for (const control of form.elements) {
    control.disabled = isBusy;
  }
}

// ===========================================================================
// 7. Event handlers
// ===========================================================================

/**
 * Both "Log in" and "Register" submit the same form;
 * `event.submitter` tells which button was used.
 *
 * @param {SubmitEvent} event
 */
async function handleAuthSubmit(event) {
  event.preventDefault();

  const form = elements.authForm;
  const username = form.elements.username.value;
  const password = form.elements.password.value;
  const authenticate = event.submitter?.value === 'register' ? register : login;

  showFormMessage(form, '');

  try {
    await authenticate(username, password);
    form.reset();
    render();
  } catch (error) {
    if (error instanceof AuthError) {
      showFormMessage(form, error.message);
    } else {
      console.error(error);
      showFormMessage(form, 'Something went wrong. Please try again.');
    }
  }
}

/** Logs the user out and switches the page to the guest view. */
function handleLogout() {
  logout();
  render();
}

/**
 * Validates the comment, lets a worker check it for inappropriate words and,
 * if it is clean, saves it under the right parent.
 *
 * @param {HTMLFormElement} form
 * @param {string | null} parentId null for a top-level comment
 */
async function submitComment(form, parentId) {
  const author = getCurrentUser();
  const text = form.elements.text.value.trim();

  showFormMessage(form, '');

  if (author === null) {
    render();
    return;
  }
  if (text === '') {
    showFormMessage(form, 'Please write something first.');
    return;
  }

  setFormBusy(form, true);

  try {
    const foundWords = await checkComment(text);

    if (foundWords.length > 0) {
      showFormMessage(form, createBlockedMessage(foundWords));
      return;
    }

    addComment({ parentId, author, text });
    form.reset();
    render();
  } catch (error) {
    // Fail closed: a comment that could not be checked is not added.
    console.error(error);
    showFormMessage(form, 'The comment could not be checked, so it was not added. Please try again.');
  } finally {
    setFormBusy(form, false);
  }
}

// ===========================================================================
// 8. Start
// ===========================================================================

/** Form for new top-level comments (replies get their own forms). */
const newCommentForm = createCommentForm({
  onSubmit: (form) => submitComment(form, null),
});

elements.newCommentSlot.append(newCommentForm);
elements.authForm.addEventListener('submit', handleAuthSubmit);
elements.logoutButton.addEventListener('click', handleLogout);
render();

// ===========================================================================
// 9. Easter egg ☮ – open the browser console and call iLovePeace()
// ===========================================================================

/** How many doves fly across the page. */
const DOVE_COUNT = 12;

/**
 * Releases doves (unless the user prefers reduced motion) and logs a message.
 *
 * @returns {string}
 */
function iLovePeace() {
  const message = 'Make peace, not war. ☮';
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!prefersReducedMotion) {
    releaseDoves(DOVE_COUNT);
  }

  console.log(`%c${message}`, 'color: #00325A; font-size: 18px;');
  return message;
}

/**
 * Adds animated doves at random positions; each one removes itself when it has flown away.
 *
 * @param {number} count
 */
function releaseDoves(count) {
  for (let i = 0; i < count; i += 1) {
    const dove = document.createElement('span');
    dove.className = 'peace-dove';
    dove.textContent = '🕊️';
    dove.setAttribute('aria-hidden', 'true');
    dove.style.left = `${Math.random() * 95}vw`;
    dove.style.animationDelay = `${Math.random() * 1.5}s`;
    dove.style.setProperty('--drift', `${Math.round(Math.random() * 200 - 100)}px`);
    dove.addEventListener('animationend', () => dove.remove());
    document.body.append(dove);
  }
}

// Modules do not create global variables, so the function is exposed explicitly.
window.iLovePeace = iLovePeace;
