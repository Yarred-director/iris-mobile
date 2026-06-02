// server/index.js — slim shell

import cors from 'cors';
import express from 'express';
import './config/env.js';

import { sessionMiddleware } from './middleware/session.js';
import chatRouter            from './routes/chat.js';
import imageRouter           from './routes/imageRoutes.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(sessionMiddleware);

app.get('/', (_req, res) => res.send('IRIS backend running'));
app.use(chatRouter);
app.use(imageRouter);

app.listen(process.env.PORT || 10000, () => {
  console.log('Iris backend running on port', process.env.PORT || 10000);
});