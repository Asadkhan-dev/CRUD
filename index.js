const fs = require('fs/promises');
const path = require('path');
const http = require('http');
const url = require('url');
const querystring = require('querystring');
require('dotenv').config();
const PORT = process.env.PORT || 3000;

const dataFile = path.join(__dirname, 'notes.json');

// Helper functions for notes
async function readNotes() {
    try {
        const raw = await fs.readFile(dataFile, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
    }
}
async function writeNotes(notes) {
    await fs.writeFile(dataFile, JSON.stringify(notes, null, 2));
}

// HTML templates
function renderLayout(title, content) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${title}</title>
        <style>
            body { font-family: sans-serif; margin: 2em; }
            .note { border: 1px solid #ccc; padding: 1em; margin-bottom: 1em; }
            a { text-decoration: none; color: #0074d9; }
        </style>
    </head>
    <body>
        <h1>${title}</h1>
        ${content}
    </body>
    </html>
    `;
}

function renderNotesList(notes) {
    return `
        <a href="/notes/new">Add Note</a>
        <div>
            ${notes.map(note => `
                <div class="note">
                    <h3><a href="/notes/${note.id}">${note.title}</a></h3>
                    <form method="POST" action="/notes/${note.id}/delete" style="display:inline;">
                        <button type="submit">Delete</button>
                    </form>
                </div>
            `).join('')}
        </div>
    `;
}

function renderNoteDetail(note) {
    return `
        <a href="/">Back to Notes</a>
        <div class="note">
            <h2>${note.title}</h2>
            <p>${note.content}</p>
            <a href="/notes/${note.id}/edit">Edit</a>
        </div>
    `;
}

function renderNoteForm(note = {}) {
    const isEdit = !!note.id;
    return `
        <a href="/">Back to Notes</a>
        <form method="POST" action="${isEdit ? `/notes/${note.id}/edit` : '/notes/new'}">
            <div>
                <label>Title:</label><br>
                <input name="title" value="${note.title || ''}" required>
            </div>
            <div>
                <label>Content:</label><br>
                <textarea name="content" required>${note.content || ''}</textarea>
            </div>
            <button type="submit">${isEdit ? 'Update' : 'Create'} Note</button>
        </form>
    `;
}

// Parse POST body
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => resolve(querystring.parse(body)));
        req.on('error', reject);
    });
}

// Server
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // --- API ROUTES ---
    if (pathname.startsWith('/api/notes')) {
        // GET /api/notes
        if (req.method === 'GET' && pathname === '/api/notes') {
            const notes = await readNotes();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(notes));
        }
        // GET /api/notes/:id
        if (req.method === 'GET' && /^\/api\/notes\/\d+$/.test(pathname)) {
            const id = Number(pathname.split('/')[3]);
            const notes = await readNotes();
            const note = notes.find(n => n.id === id);
            if (!note) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Note not found' }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(note));
        }
        // POST /api/notes
        if (req.method === 'POST' && pathname === '/api/notes') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                const data = JSON.parse(body);
                const notes = await readNotes();
                const note = { id: Date.now(), title: data.title, content: data.content };
                notes.push(note);
                await writeNotes(notes);
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(note));
            });
            return;
        }
        // PUT /api/notes/:id
        if (req.method === 'PUT' && /^\/api\/notes\/\d+$/.test(pathname)) {
            const id = Number(pathname.split('/')[3]);
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                const data = JSON.parse(body);
                let notes = await readNotes();
                const idx = notes.findIndex(n => n.id === id);
                if (idx === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Note not found' }));
                }
                notes[idx] = { ...notes[idx], ...data };
                await writeNotes(notes);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(notes[idx]));
            });
            return;
        }
        // DELETE /api/notes/:id
        if (req.method === 'DELETE' && /^\/api\/notes\/\d+$/.test(pathname)) {
            const id = Number(pathname.split('/')[3]);
            let notes = await readNotes();
            const idx = notes.findIndex(n => n.id === id);
            if (idx === -1) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Note not found' }));
            }
            const deleted = notes.splice(idx, 1)[0];
            await writeNotes(notes);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(deleted));
            return;
        }
    }

    // --- WEB ROUTES (SSR) ---
    // Home: List notes
    if (req.method === 'GET' && pathname === '/') {
        const notes = await readNotes();
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(renderLayout('Notes', renderNotesList(notes)));
    }
    // New note form
    if (req.method === 'GET' && pathname === '/notes/new') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(renderLayout('New Note', renderNoteForm()));
    }
    // Create note (form POST)
    if (req.method === 'POST' && pathname === '/notes/new') {
        const data = await parseBody(req);
        const notes = await readNotes();
        const note = { id: Date.now(), title: data.title, content: data.content };
        notes.push(note);
        await writeNotes(notes);
        res.writeHead(302, { Location: '/' });
        return res.end();
    }
    // View note
    if (req.method === 'GET' && /^\/notes\/\d+$/.test(pathname)) {
        const id = Number(pathname.split('/')[2]);
        const notes = await readNotes();
        const note = notes.find(n => n.id === id);
        if (!note) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            return res.end(renderLayout('Not Found', '<div>Note not found</div>'));
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(renderLayout(note.title, renderNoteDetail(note)));
    }
    // Edit note form
    if (req.method === 'GET' && /^\/notes\/\d+\/edit$/.test(pathname)) {
        const id = Number(pathname.split('/')[2]);
        const notes = await readNotes();
        const note = notes.find(n => n.id === id);
        if (!note) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            return res.end(renderLayout('Not Found', '<div>Note not found</div>'));
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(renderLayout('Edit Note', renderNoteForm(note)));
    }
    // Edit note (form POST)
    if (req.method === 'POST' && /^\/notes\/\d+\/edit$/.test(pathname)) {
        const id = Number(pathname.split('/')[2]);
        const data = await parseBody(req);
        let notes = await readNotes();
        const idx = notes.findIndex(n => n.id === id);
        if (idx === -1) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            return res.end(renderLayout('Not Found', '<div>Note not found</div>'));
        }
        notes[idx] = { ...notes[idx], ...data };
        await writeNotes(notes);
        res.writeHead(302, { Location: `/notes/${id}` });
        return res.end();
    }
    // Delete note (form POST)
    if (req.method === 'POST' && /^\/notes\/\d+\/delete$/.test(pathname)) {
        const id = Number(pathname.split('/')[2]);
        let notes = await readNotes();
        const idx = notes.findIndex(n => n.id === id);
        if (idx === -1) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            return res.end(renderLayout('Not Found', '<div>Note not found</div>'));
        }
        notes.splice(idx, 1);
        await writeNotes(notes);
        res.writeHead(302, { Location: '/' });
        return res.end();
    }

    // Not found
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(renderLayout('Not Found', '<div>404 Not Found</div>'));
});

server.listen(PORT, () => {
    console.log(`Note app running at http://localhost:${PORT}`);
});