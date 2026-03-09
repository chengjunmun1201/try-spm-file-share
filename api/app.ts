import express from 'express';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import cookieParser from 'cookie-parser';
import Redis from 'ioredis';
import { GoogleGenAI, Type } from '@google/genai';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// --- Redis Database for Points and Locks ---
let redis: Redis | null = null;

try {
  if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      connectTimeout: 10000,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError(err) {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      }
    });

    if (redis) {
      redis.on('error', (err) => {
        console.error('Redis connection error:', err);
      });
      redis.on('connect', () => {
        console.log('Connected to Redis');
      });
    }
  } else {
    console.warn('REDIS_URL not found. Falling back to in-memory storage (data will be lost on restart).');
  }
} catch (error) {
  console.error('Redis initialization failed:', error);
  redis = null;
}

// Fallback in-memory storage if Redis is not available
const usersDbMem = new Map<string, any>();
const lockedFoldersConfigMem = new Map<string, number>();
const unlockedFoldersDbMem = new Map<string, Set<string>>();

async function getUser(email: string) {
  if (redis) {
    try {
      const data = await redis.hgetall(`user:${email}`);
      if (Object.keys(data).length === 0) return null;
      return { ...data, points: parseInt(data.points || '0', 10) };
    } catch (err) {
      console.error('Redis getUser error:', err);
      // Fallback to memory
    }
  }
  return usersDbMem.get(email) || null;
}

async function saveUser(email: string, name: string, points: number) {
  if (redis) {
    try {
      await redis.hset(`user:${email}`, { email, name, points: points.toString() });
      await redis.sadd('user_emails', email);
      return;
    } catch (err) {
      console.error('Redis saveUser error:', err);
      // Fallback to memory
    }
  }
  usersDbMem.set(email, { email, name, points });
}

async function addPoints(email: string, pointsToAdd: number) {
  if (redis) {
    try {
      const newPoints = await redis.hincrby(`user:${email}`, 'points', pointsToAdd);
      return newPoints;
    } catch (err) {
      console.error('Redis addPoints error:', err);
    }
  }
  const user = usersDbMem.get(email);
  if (user) {
    user.points += pointsToAdd;
    usersDbMem.set(email, user);
    return user.points;
  }
  return 0;
}

async function ensureUser(email: string, name: string) {
  const user = await getUser(email);
  if (!user) {
    await saveUser(email, name, 100); // Give 100 initial points
  }
}

async function getLockedFolders() {
  if (redis) {
    try {
      const data = await redis.hgetall('locked_folders');
      const folders: { id: string, cost: number }[] = [];
      for (const [id, cost] of Object.entries(data)) {
        folders.push({ id, cost: parseInt(cost, 10) });
      }
      return folders;
    } catch (err) {
      console.error('Redis getLockedFolders error:', err);
    }
  }
  return Array.from(lockedFoldersConfigMem.entries()).map(([id, cost]) => ({ id, cost }));
}

async function getFolderCost(folderId: string) {
  if (redis) {
    try {
      const cost = await redis.hget('locked_folders', folderId);
      return cost ? parseInt(cost, 10) : null;
    } catch (err) {
      console.error('Redis getFolderCost error:', err);
    }
  }
  return lockedFoldersConfigMem.get(folderId) ?? null;
}

async function setFolderLock(folderId: string, cost: number | null) {
  if (redis) {
    try {
      if (cost === null) {
        await redis.hdel('locked_folders', folderId);
      } else {
        await redis.hset('locked_folders', folderId, cost.toString());
      }
      return;
    } catch (err) {
      console.error('Redis setFolderLock error:', err);
    }
  }
  if (cost === null) {
    lockedFoldersConfigMem.delete(folderId);
  } else {
    lockedFoldersConfigMem.set(folderId, cost);
  }
}

async function isFolderUnlocked(email: string, folderId: string) {
  if (redis) {
    try {
      return await redis.sismember(`unlocked:${email}`, folderId) === 1;
    } catch (err) {
      console.error('Redis isFolderUnlocked error:', err);
    }
  }
  return unlockedFoldersDbMem.get(email)?.has(folderId) || false;
}

async function unlockFolder(email: string, folderId: string) {
  if (redis) {
    try {
      await redis.sadd(`unlocked:${email}`, folderId);
      return;
    } catch (err) {
      console.error('Redis unlockFolder error:', err);
    }
  }
  if (!unlockedFoldersDbMem.has(email)) unlockedFoldersDbMem.set(email, new Set());
  unlockedFoldersDbMem.get(email)?.add(folderId);
}

async function getAllUsers() {
  if (redis) {
    try {
      const emails = await redis.smembers('user_emails');
      const users = [];
      for (const email of emails) {
        const user = await getUser(email);
        if (user) users.push(user);
      }
      return users;
    } catch (err) {
      console.error('Redis getAllUsers error:', err);
    }
  }
  return Array.from(usersDbMem.values());
}

async function deleteUser(email: string) {
  if (redis) {
    try {
      await redis.del(`user:${email}`);
      await redis.del(`unlocked:${email}`);
      await redis.srem('user_emails', email);
      return;
    } catch (err) {
      console.error('Redis deleteUser error:', err);
    }
  }
  usersDbMem.delete(email);
  unlockedFoldersDbMem.delete(email);
}

const ADMIN_EMAILS = ['junmunchenh@gmail.com'];
// -----------------------------------------------

// Initialize Google Drive JWT Client
function getDriveClient(req?: express.Request) {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  // Handle private key formatting (replace literal \n with actual newlines and remove surrounding quotes)
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n');
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.substring(1, privateKey.length - 1);
    }
  }

  if (!clientEmail || !privateKey) {
    throw new Error('Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY in environment variables.');
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });

  return google.drive({ version: 'v3', auth });
}

app.get('/api/auth/url', (req, res) => {
  const redirectUri = req.query.redirect_uri as string;
  if (!redirectUri) {
    return res.status(400).json({ error: 'redirect_uri is required' });
  }
  
  const params = new URLSearchParams({
    client_id: process.env.OAUTH_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',
    state: redirectUri
  });
  
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url: authUrl });
});

app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
  const { code, state } = req.query;
  const redirectUri = state as string;
  
  if (!code || !redirectUri) {
    return res.status(400).send('Missing code or state');
  }
  
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: process.env.OAUTH_CLIENT_ID || '',
        client_secret: process.env.OAUTH_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    
    const tokens = await tokenResponse.json();
    
    if (tokens.access_token) {
      res.cookie('google_access_token', tokens.access_token, {
        secure: true,
        sameSite: 'none',
        httpOnly: true,
        maxAge: tokens.expires_in * 1000
      });
      if (tokens.refresh_token) {
        res.cookie('google_refresh_token', tokens.refresh_token, {
          secure: true,
          sameSite: 'none',
          httpOnly: true,
          maxAge: 30 * 24 * 60 * 60 * 1000
        });
      }
    }
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/api/auth/status', async (req, res) => {
  const accessToken = req.cookies.google_access_token;
  if (!accessToken) {
    return res.json({ loggedIn: false });
  }
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    
    if (userInfo.data.email && userInfo.data.name) {
      await ensureUser(userInfo.data.email, userInfo.data.name);
    }
    
    const userRecord = userInfo.data.email ? await getUser(userInfo.data.email) : null;
    const isAdmin = userInfo.data.email ? ADMIN_EMAILS.includes(userInfo.data.email) : false;

    res.json({ 
      loggedIn: true, 
      user: {
        ...userInfo.data,
        points: userRecord?.points || 0,
        isAdmin
      }
    });
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.json({ loggedIn: false });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('google_access_token', { secure: true, sameSite: 'none', httpOnly: true });
  res.clearCookie('google_refresh_token', { secure: true, sameSite: 'none', httpOnly: true });
  res.json({ success: true });
});

app.get('/api/drive/files', async (req, res) => {
  try {
    const drive = getDriveClient(req);
    const { q, pageToken, folderId } = req.query;
    
    const targetFolderId = folderId && typeof folderId === 'string' 
      ? folderId 
      : process.env.DRIVE_FOLDER_ID;

    if (!targetFolderId) {
      return res.status(400).json({ error: 'DRIVE_FOLDER_ID is not configured in environment variables.' });
    }

    let query = `'${targetFolderId}' in parents and trashed = false`;
    if (q && typeof q === 'string') {
      // Basic search by name
      query += ` and name contains '${q.replace(/'/g, "\\'")}'`;
    }

    const response = await drive.files.list({
      q: query,
      pageSize: 50,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, iconLink, webViewLink, webContentLink)',
      orderBy: 'folder, modifiedTime desc', // Folders first
      pageToken: pageToken as string | undefined,
    });

    // Check auth for unlocked status
    let userEmail = '';
    const accessToken = req.cookies.google_access_token;
    if (accessToken) {
      try {
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: accessToken });
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        if (userInfo.data.email) {
          userEmail = userInfo.data.email;
        }
      } catch (e) {
        // ignore
      }
    }

    const lockedFolders = await getLockedFolders();
    const filesWithLockStatus = await Promise.all((response.data.files || []).map(async (file) => {
      const lockConfig = lockedFolders.find(f => f.id === file.id);
      if (file.mimeType === 'application/vnd.google-apps.folder' && file.id && lockConfig) {
        const cost = lockConfig.cost;
        const unlocked = userEmail ? await isFolderUnlocked(userEmail, file.id) : false;
        return { ...file, isLocked: true, cost, unlocked };
      }
      return file;
    }));

    res.json({ files: filesWithLockStatus, nextPageToken: response.data.nextPageToken });
  } catch (error: any) {
    console.error('Error fetching files:', error);
    
    // Check if it's the specific "API not enabled" error
    if (error.message && error.message.includes('has not been used in project') && error.message.includes('before or it is disabled')) {
      return res.status(403).json({ 
        error: 'The Google Drive API is not enabled for your Google Cloud Project. Please click the link in your Google Cloud Console to enable it, wait a few minutes, and try again.',
        details: error.message
      });
    }

    res.status(500).json({ error: error.message || 'Failed to fetch files' });
  }
});

app.get('/api/drive/download/:fileId', async (req, res) => {
  try {
    const drive = getDriveClient(req);
    const fileId = req.params.fileId;
    
    // Get file metadata to know mimeType and links
    const fileMeta = await drive.files.get({
      fileId: fileId,
      fields: 'name, mimeType, webContentLink, webViewLink'
    });
    
    const isGoogleWorkspaceType = fileMeta.data.mimeType?.startsWith('application/vnd.google-apps.');
    const isInline = req.query.inline === 'true';
    
    // --- INLINE PREVIEW (Proxy via Vercel to avoid CORS and keep custom UI) ---
    if (isInline) {
      if (isGoogleWorkspaceType) {
        let exportMimeType = 'application/pdf';
        let extension = '.pdf';
        
        if (fileMeta.data.mimeType === 'application/vnd.google-apps.document') {
          exportMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          extension = '.docx';
        } else if (fileMeta.data.mimeType === 'application/vnd.google-apps.spreadsheet') {
          exportMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          extension = '.xlsx';
        } else if (fileMeta.data.mimeType === 'application/vnd.google-apps.presentation') {
          exportMimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
          extension = '.pptx';
        }
        
        const response = await drive.files.export({
          fileId: fileId,
          mimeType: exportMimeType
        }, { responseType: 'stream' });
        
        res.setHeader('Content-Disposition', `inline; filename="${fileMeta.data.name}${extension}"`);
        res.setHeader('Content-Type', exportMimeType);
        return response.data.pipe(res);
      } else {
        const response = await drive.files.get({
          fileId: fileId,
          alt: 'media',
          acknowledgeAbuse: true
        }, { responseType: 'stream' });
        
        res.setHeader('Content-Disposition', `inline; filename="${fileMeta.data.name}"`);
        if (fileMeta.data.mimeType) {
          res.setHeader('Content-Type', fileMeta.data.mimeType);
        }
        return response.data.pipe(res);
      }
    }
    
    // --- ACTUAL DOWNLOAD (Direct Redirect to save Vercel bandwidth) ---
    if (isGoogleWorkspaceType) {
      let exportUrl = '';
      if (fileMeta.data.mimeType === 'application/vnd.google-apps.document') {
        exportUrl = `https://docs.google.com/document/d/${fileId}/export?format=pdf`;
      } else if (fileMeta.data.mimeType === 'application/vnd.google-apps.spreadsheet') {
        exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`;
      } else if (fileMeta.data.mimeType === 'application/vnd.google-apps.presentation') {
        exportUrl = `https://docs.google.com/presentation/d/${fileId}/export/pdf`;
      } else {
        exportUrl = fileMeta.data.webViewLink || '';
      }
      
      if (exportUrl) {
        return res.redirect(exportUrl);
      } else {
        return res.status(404).json({ error: 'Export link not available' });
      }
    } else {
      if (fileMeta.data.webContentLink) {
        return res.redirect(fileMeta.data.webContentLink);
      } else {
        // Fallback to proxy if webContentLink is missing (e.g., file not shared publicly)
        const response = await drive.files.get({
          fileId: fileId,
          alt: 'media',
          acknowledgeAbuse: true
        }, { responseType: 'stream' });
        
        res.setHeader('Content-Disposition', `attachment; filename="${fileMeta.data.name}"`);
        if (fileMeta.data.mimeType) {
          res.setHeader('Content-Type', fileMeta.data.mimeType);
        }
        return response.data.pipe(res);
      }
    }
  } catch (error: any) {
    console.error('Error downloading file:', error);
    res.status(500).json({ error: error.message || 'Failed to download file' });
  }
});

async function calculateTotalSize(drive: any, fileIds: string[]): Promise<number> {
  let totalSize = 0;

  async function getSize(fileId: string) {
    const fileMeta = await drive.files.get({
      fileId: fileId,
      fields: 'id, mimeType, size'
    });

    const { id, mimeType, size } = fileMeta.data;
    const isFolder = mimeType === 'application/vnd.google-apps.folder';

    if (isFolder) {
      let pageToken;
      do {
        const response = await drive.files.list({
          q: `'${id}' in parents and trashed = false`,
          pageSize: 100,
          fields: 'nextPageToken, files(id)',
          pageToken: pageToken
        });

        const files = response.data.files || [];
        for (const file of files) {
          if (file.id) {
            await getSize(file.id);
          }
        }
        pageToken = response.data.nextPageToken;
      } while (pageToken);
    } else {
      if (size) {
        totalSize += parseInt(size, 10);
      } else {
        // Estimate size for Google Workspace files (they don't have a size property)
        totalSize += 1024 * 1024; // Assume 1MB for workspace files as an estimate
      }
    }
  }

  for (const fileId of fileIds) {
    await getSize(fileId);
  }

  return totalSize;
}

async function addFilesToZip(drive: any, fileId: string, archive: archiver.Archiver, currentPath: string) {
  const fileMeta = await drive.files.get({
    fileId: fileId,
    fields: 'id, name, mimeType'
  });

  const { id, name, mimeType } = fileMeta.data;
  const isFolder = mimeType === 'application/vnd.google-apps.folder';

  if (isFolder) {
    const folderPath = currentPath ? `${currentPath}${name}/` : `${name}/`;
    archive.append('', { name: folderPath }); // Create empty folder

    let pageToken;
    do {
      const response = await drive.files.list({
        q: `'${id}' in parents and trashed = false`,
        pageSize: 100,
        fields: 'nextPageToken, files(id)',
        pageToken: pageToken
      });

      const files = response.data.files || [];
      for (const file of files) {
        if (file.id) {
          await addFilesToZip(drive, file.id, archive, folderPath);
        }
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken);
  } else {
    const isGoogleWorkspaceType = mimeType?.startsWith('application/vnd.google-apps.');
    let stream;
    let fileName = name;

    if (isGoogleWorkspaceType) {
      let exportMimeType = 'application/pdf';
      let extension = '.pdf';
      
      if (mimeType === 'application/vnd.google-apps.document') {
        exportMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        extension = '.docx';
      } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        exportMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        extension = '.xlsx';
      } else if (mimeType === 'application/vnd.google-apps.presentation') {
        exportMimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        extension = '.pptx';
      }
      
      try {
        const response = await drive.files.export({
          fileId: id,
          mimeType: exportMimeType
        }, { responseType: 'stream' });
        stream = response.data;
        fileName = `${name}${extension}`;
      } catch (err) {
        console.error(`Failed to export ${name}:`, err);
        return;
      }
    } else {
      try {
        const response = await drive.files.get({
          fileId: id,
          alt: 'media',
          acknowledgeAbuse: true
        }, { responseType: 'stream' });
        stream = response.data;
      } catch (err) {
        console.error(`Failed to download ${name}:`, err);
        return;
      }
    }

    const filePath = currentPath ? `${currentPath}${fileName}` : fileName;
    archive.append(stream, { name: filePath });
  }
}

app.post('/api/drive/download-batch', async (req, res) => {
  try {
    const { fileIds } = req.body;
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'No files specified' });
    }

    const drive = getDriveClient(req);
    
    // Calculate total size for progress bar
    // Note: This is an estimate because zip compression will change the final size,
    // and Google Workspace files don't have a known size until exported.
    // We use store: true in archiver to avoid compression so the size is more accurate.
    const estimatedTotalSize = await calculateTotalSize(drive, fileIds);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="download.zip"');
    res.setHeader('X-Estimated-Content-Length', estimatedTotalSize.toString());

    const archive = archiver('zip', {
      zlib: { level: 0 }, // No compression to make size estimation more accurate
      store: true
    });

    archive.on('error', function(err) {
      console.error('Archiver error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });

    archive.pipe(res);

    for (const fileId of fileIds) {
      await addFilesToZip(drive, fileId, archive, '');
    }

    archive.finalize();
  } catch (error: any) {
    console.error('Error in batch download:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to download files' });
    }
  }
});

// --- Points & Admin Endpoints ---

app.post('/api/folder/unlock', async (req, res) => {
  const { folderId } = req.body;
  const accessToken = req.cookies.google_access_token;
  if (!accessToken) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    if (!email) return res.status(401).json({ error: 'Email not found' });
    
    const cost = await getFolderCost(folderId);
    if (cost === null) return res.status(400).json({ error: 'Folder is not locked' });

    const userRecord = await getUser(email);
    if (!userRecord) return res.status(404).json({ error: 'User not found' });

    if (await isFolderUnlocked(email, folderId)) {
      return res.json({ success: true, message: 'Already unlocked' });
    }

    if (userRecord.points < cost) {
      return res.status(400).json({ error: 'Not enough points' });
    }

    // Deduct points and unlock
    await saveUser(email, userRecord.name, userRecord.points - cost);
    await unlockFolder(email, folderId);

    res.json({ success: true, points: userRecord.points - cost });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Admin middleware
async function isAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const accessToken = req.cookies.google_access_token;
  if (!accessToken) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    if (!userInfo.data.email || !ADMIN_EMAILS.includes(userInfo.data.email)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

app.get('/api/admin/users', isAdmin, async (req, res) => {
  const users = await getAllUsers();
  res.json(users);
});

app.post('/api/admin/points', isAdmin, async (req, res) => {
  const { email, points } = req.body;
  const user = await getUser(email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await saveUser(email, user.name, points);
  res.json({ success: true, user: { ...user, points } });
});

app.post('/api/admin/points/bulk', isAdmin, async (req, res) => {
  const { points, action } = req.body; // action: 'add' or 'set'
  const users = await getAllUsers();
  for (const user of users) {
    if (action === 'add') {
      await saveUser(user.email, user.name, user.points + points);
    } else if (action === 'set') {
      await saveUser(user.email, user.name, points);
    }
  }
  res.json({ success: true });
});

app.delete('/api/admin/users/:email', isAdmin, async (req, res) => {
  const email = req.params.email;
  await deleteUser(email);
  res.json({ success: true });
});

app.get('/api/admin/folders', isAdmin, async (req, res) => {
  const folders = await getLockedFolders();
  res.json(folders);
});

app.post('/api/admin/folders', isAdmin, async (req, res) => {
  const { folderId, cost } = req.body;
  await setFolderLock(folderId, cost === null || cost === undefined ? null : cost);
  res.json({ success: true });
});

// --------------------------------

// --- Topup Endpoints ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

async function getUserEmailFromReq(req: express.Request): Promise<string | null> {
  const accessToken = req.cookies.google_access_token;
  if (!accessToken) return null;
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    return userInfo.data.email || null;
  } catch (e) {
    return null;
  }
}

const topupOrdersMem = new Map<string, any>();
const rateLimitMem = new Map<string, number>();

async function checkRateLimit(key: string): Promise<boolean> {
  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 86400);
    return count <= 5;
  } else {
    const count = (rateLimitMem.get(key) || 0) + 1;
    rateLimitMem.set(key, count);
    return count <= 5;
  }
}

app.post('/api/topup/create', async (req, res) => {
  const email = await getUserEmailFromReq(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const { credits } = req.body;
  if (!credits || credits < 10 || credits % 10 !== 0) {
    return res.status(400).json({ error: 'Invalid credits amount. Must be multiple of 10.' });
  }

  const amountRM = credits / 10;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const today = new Date().toISOString().split('T')[0];
  
  const canCreateEmail = await checkRateLimit(`ratelimit:topup:${email}:${today}`);
  const canCreateIp = await checkRateLimit(`ratelimit:topup:${ip}:${today}`);
  
  if (!canCreateEmail || !canCreateIp) {
    return res.status(429).json({ error: 'Daily order limit reached (5 orders/day).' });
  }

  const orderId = `TNG-${new Date().toISOString().replace(/[-T:Z.]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
  
  const order = {
    orderId,
    email,
    credits,
    amountRM,
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000,
  };

  if (redis) {
    await redis.set(`order:${orderId}`, JSON.stringify(order), 'EX', 86400);
    await redis.set(`current_order:${email}`, orderId, 'EX', 600);
  } else {
    topupOrdersMem.set(orderId, order);
    topupOrdersMem.set(`current_order:${email}`, orderId);
  }

  res.json({ success: true, order });
});

app.get('/api/topup/current', async (req, res) => {
  const email = await getUserEmailFromReq(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  let orderId = null;
  if (redis) {
    orderId = await redis.get(`current_order:${email}`);
  } else {
    orderId = topupOrdersMem.get(`current_order:${email}`);
  }

  if (!orderId) return res.json({ order: null });

  let order = null;
  if (redis) {
    const data = await redis.get(`order:${orderId}`);
    if (data) order = JSON.parse(data);
  } else {
    order = topupOrdersMem.get(orderId);
  }

  if (!order || order.status !== 'pending' || order.expiresAt < Date.now()) {
    return res.json({ order: null });
  }

  res.json({ order });
});

app.post('/api/topup/upload', async (req, res) => {
  const email = await getUserEmailFromReq(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const { orderId, imageBase64 } = req.body;
  if (!orderId || !imageBase64) return res.status(400).json({ error: 'Missing orderId or image' });

  let order = null;
  if (redis) {
    const data = await redis.get(`order:${orderId}`);
    if (data) order = JSON.parse(data);
  } else {
    order = topupOrdersMem.get(orderId);
  }

  if (!order || order.email !== email) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'pending' && order.status !== 'failed') return res.status(400).json({ error: 'Order cannot be processed' });
  if (order.expiresAt < Date.now()) return res.status(400).json({ error: 'Order has expired' });

  try {
    order.screenshot = imageBase64; // Save screenshot to database

    const invokeUrl = "https://integrate.api.nvidia.com/v1/chat/completions";
    const apiKey = process.env.NVIDIA_API_KEY || "nvxxxxxRKDMoJ4";
    const headers = {
      "Authorization": apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
      "Accept": "application/json"
    };

    const payload = {
      "model": "qwen/qwen3.5-397b-a17b",
      "messages": [
        {
          "role": "user",
          "content": [
            {
              "type": "text",
              "text": `Extract the following information from this Touch 'n Go eWallet transfer screenshot.
              Return ONLY a JSON object with these exact keys:
              - amount: (number, the transfer amount in RM)
              - transactionId: (string, the Reference ID or Transaction ID)
              - remarks: (string, the notes or remarks entered by the user)
              - time: (string, the date and time of the transaction)
              - isEdited: (boolean, true if the image looks photoshopped, manipulated, or fake)
              
              If you cannot find a value, use null.`
            },
            {
              "type": "image_url",
              "image_url": {
                "url": imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`
              }
            }
          ]
        }
      ],
      "max_tokens": 16384,
      "temperature": 0.60,
      "top_p": 0.95,
      "top_k": 20,
      "presence_penalty": 0,
      "repetition_penalty": 1,
      "stream": false,
      "chat_template_kwargs": {"enable_thinking":true}
    };

    const response = await axios.post(invokeUrl, payload, { headers });
    const content = response.data.choices[0].message.content;
    
    // Robustly extract JSON from the response content
    let extracted = {};
    try {
      // Find the first '{' and the last '}'
      const startIndex = content.indexOf('{');
      const endIndex = content.lastIndexOf('}');
      
      if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        const jsonString = content.substring(startIndex, endIndex + 1);
        extracted = JSON.parse(jsonString);
      } else {
        // Fallback to the original regex replacement if no braces found
        extracted = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim() || '{}');
      }
    } catch (e) {
      console.error('Failed to parse JSON from AI response:', content);
      throw new Error('Invalid JSON response from AI');
    }
    
    const isAmountMatch = extracted.amount === order.amountRM;
    const isRemarkMatch = extracted.remarks && extracted.remarks.includes(order.orderId);
    
    let isTxUnique = true;
    if (extracted.transactionId) {
      if (redis) {
        const existingOrderId = await redis.get(`tx:${extracted.transactionId}`);
        if (existingOrderId && existingOrderId !== orderId) {
          isTxUnique = false;
        } else {
          await redis.set(`tx:${extracted.transactionId}`, orderId, 'EX', 86400 * 30);
        }
      } else {
        const existingOrderId = topupOrdersMem.get(`tx:${extracted.transactionId}`);
        if (existingOrderId && existingOrderId !== orderId) {
          isTxUnique = false;
        } else {
          topupOrdersMem.set(`tx:${extracted.transactionId}`, orderId);
        }
      }
    } else {
      isTxUnique = false;
    }

    if (!isAmountMatch || !isRemarkMatch || !isTxUnique || extracted.isEdited) {
      order.aiExtractedInfo = extracted;
      order.status = 'failed';
      if (redis) {
        await redis.set(`order:${orderId}`, JSON.stringify(order), 'EX', 86400);
      } else {
        topupOrdersMem.set(orderId, order);
      }
      
      return res.status(400).json({ 
        error: 'Recognition failed, please ensure screenshot is clear or retry.',
        details: {
          amountMatch: isAmountMatch,
          remarkMatch: isRemarkMatch,
          txUnique: isTxUnique,
          isEdited: extracted.isEdited
        }
      });
    }

    let newPoints = 0;
    const userRecord = await getUser(email);
    if (userRecord) {
      newPoints = await addPoints(email, order.credits);
    }

    order.status = 'completed';
    order.transactionId = extracted.transactionId;
    order.aiExtractedInfo = extracted;
    
    if (redis) {
      await redis.set(`order:${orderId}`, JSON.stringify(order), 'EX', 86400);
      await redis.del(`current_order:${email}`);
    } else {
      topupOrdersMem.set(orderId, order);
      topupOrdersMem.delete(`current_order:${email}`);
    }

    res.json({ success: true, order, newPoints });

  } catch (error: any) {
    console.error('AI Processing error:', error);
    
    // Save the order with the screenshot even if AI fails
    order.status = 'failed';
    if (redis) {
      await redis.set(`order:${orderId}`, JSON.stringify(order), 'EX', 86400);
    } else {
      topupOrdersMem.set(orderId, order);
    }
    
    res.status(500).json({ error: 'Failed to process image. Please try again.' });
  }
});

app.post('/api/topup/appeal', async (req, res) => {
  const email = await getUserEmailFromReq(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const { orderId, phone } = req.body;
  if (!orderId || !phone) return res.status(400).json({ error: 'Missing orderId or phone' });

  let order = null;
  if (redis) {
    const data = await redis.get(`order:${orderId}`);
    if (data) order = JSON.parse(data);
  } else {
    order = topupOrdersMem.get(orderId);
  }

  if (!order || order.email !== email) return res.status(404).json({ error: 'Order not found' });
  
  order.status = 'appealed';
  order.appealPhone = phone;

  if (redis) {
    await redis.set(`order:${orderId}`, JSON.stringify(order), 'EX', 86400);
    await redis.del(`current_order:${email}`);
  } else {
    topupOrdersMem.set(orderId, order);
    topupOrdersMem.delete(`current_order:${email}`);
  }

  res.json({ success: true });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error', 
    message: err.message || 'An unexpected error occurred',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.resolve(__dirname, '..', 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, '..', 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Only start the server if we are not running on Vercel
if (!process.env.VERCEL) {
  startServer();
}

export default app;
