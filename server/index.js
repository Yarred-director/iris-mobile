import cors from 'cors';
import express from 'express';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.post('/chat', (req, res) => {
  const { message } = req.body;

  res.json({
    reply: `Backend počul: "${message}"`,
  });
});

app.listen(PORT, () => {
  console.log(`Backend beží na http://localhost:${PORT}`);
});
