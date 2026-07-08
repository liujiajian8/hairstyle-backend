require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const EACHLABS_API_KEY = process.env.EACHLABS_API_KEY;

if (!EACHLABS_API_KEY) {
  console.warn('⚠️  没有检测到 EACHLABS_API_KEY，请检查 .env 文件是否配置正确。');
}

app.use(cors());
app.use(express.json({ limit: '15mb' })); // 手机拍照上传的base64可能有几MB，留够空间

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/static', express.static(path.join(__dirname, 'public')));

// ---- 发型方向预设：跟前端页面的4个风格卡片一一对应 ----
// 想增删/修改风格，改这里就行，不用改前端代码结构
const STYLE_PRESETS = [
  {
    key: 'air-bangs-mid-layers',
    name: '空气刘海 + 中长层次',
    reason: '适合想要减龄、修饰额头比例的方向',
    gender: 'female',
    haircut: 'long layered hair with soft wispy air bangs',
    hair_color: 'Black'
  },
  {
    key: 'collarbone-bob',
    name: '锁骨波波头',
    reason: '适合想利落一点、又不想剪太短的方向',
    gender: 'female',
    haircut: 'collarbone-length bob haircut, slightly inward curled ends',
    hair_color: 'Black'
  },
  {
    key: 'chestnut-long-wave',
    name: '低调栗棕长卷发',
    reason: '适合想显气质、日常打理不想太麻烦的方向',
    gender: 'female',
    haircut: 'long loose wavy curls',
    hair_color: 'Chestnut'
  },
  {
    key: 'french-bangs-layers',
    name: '高层次法式刘海',
    reason: '适合想调整脸型比例、增加轮廓感的方向',
    gender: 'female',
    haircut: 'french curtain bangs with layered medium length haircut',
    hair_color: 'Black'
  }
];

app.get('/api/styles', (req, res) => {
  res.json(STYLE_PRESETS.map(({ key, name, reason }) => ({ key, name, reason })));
});

app.get('/', (req, res) => {
  res.send('镜前 - 发型预览后端服务运行中');
});

// ---- 1. 接收上传的照片（base64），存成一个可以被外部访问的URL ----
app.post('/api/upload', (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: '缺少图片数据' });
    }
    const matches = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: '图片格式不正确，请重新上传' });
    }
    const mimeExt = matches[1].split('/')[1];
    const ext = mimeExt === 'jpeg' ? 'jpg' : mimeExt;
    const buffer = Buffer.from(matches[2], 'base64');

    const filename = `${uuidv4()}.${ext}`;
    const filepath = path.join(uploadsDir, filename);
    fs.writeFileSync(filepath, buffer);

    // 隐私保护：30分钟后自动删除这张临时照片，不长期保留
    setTimeout(() => {
      fs.unlink(filepath, () => {});
    }, 30 * 60 * 1000);

    const url = `${PUBLIC_BASE_URL}/static/uploads/${filename}`;
    res.json({ url });
  } catch (err) {
    console.error('upload error:', err);
    res.status(500).json({ error: '上传失败，请重试' });
  }
});

// ---- 2. 调用 Eachlabs change-haircut，生成对应风格的图 ----
app.post('/api/generate-hairstyle', async (req, res) => {
  try {
    const { imageUrl, styleKey } = req.body;
    const preset = STYLE_PRESETS.find(s => s.key === styleKey);
    if (!preset) return res.status(400).json({ error: '未知的发型方向' });
    if (!imageUrl) return res.status(400).json({ error: '缺少图片地址' });
    if (!EACHLABS_API_KEY) return res.status(500).json({ error: '服务端未配置API Key' });

    // 2.1 提交生成任务
    const createResp = await fetch('https://api.eachlabs.ai/v1/prediction/', {
      method: 'POST',
      headers: {
        'X-API-Key': EACHLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'change-haircut',
        version: '0.0.1',
        input: {
          gender: preset.gender,
          haircut: preset.haircut,
          hair_color: preset.hair_color,
          input_image: imageUrl,
          aspect_ratio: '1:1',
          output_format: 'png',
          safety_tolerance: 2
        },
        webhook_url: ''
      })
    });

    if (!createResp.ok) {
      const text = await createResp.text();
      console.error('Eachlabs 创建任务失败:', createResp.status, text);
      return res.status(502).json({ error: 'AI服务调用失败，请稍后重试' });
    }

    const created = await createResp.json();
    const predictionId = created.predictionID || created.id;
    if (!predictionId) {
      console.error('没有拿到 predictionID:', created);
      return res.status(502).json({ error: 'AI服务返回异常' });
    }

    // 2.2 轮询结果，最多等待约45秒（change-haircut 官方预估耗时在15秒左右）
    let result = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const checkResp = await fetch(`https://api.eachlabs.ai/v1/prediction/${predictionId}`, {
        headers: { 'X-API-Key': EACHLABS_API_KEY }
      });
      const data = await checkResp.json();

      if (data.status === 'success') {
        result = data;
        break;
      }
      if (data.status === 'error' || data.status === 'failed') {
        console.error('生成失败:', data);
        return res.status(502).json({ error: '这张照片生成失败了，换一张试试～' });
      }
      // 其他状态（pending/processing）继续等
    }

    if (!result) {
      return res.status(504).json({ error: '生成有点慢，请稍后重试' });
    }

    res.json({ imageUrl: result.output, styleName: preset.name });
  } catch (err) {
    console.error('generate-hairstyle error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ 服务已启动: http://localhost:${PORT}`);
  console.log(`   对外访问地址(PUBLIC_BASE_URL): ${PUBLIC_BASE_URL}`);
});
