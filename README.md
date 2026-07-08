# 镜前 · 发型预览后端服务

这是配合前端页面 `hairstyle-preview-demo.html` 使用的后端代理服务，作用是：
接收用户上传的照片 → 调用 Eachlabs 的 `change-haircut` 模型 → 把生成结果返回给前端展示。

为什么需要这一层后端，不能让前端直接调用 AI 服务？因为调用第三方API需要用到你的 API Key，
如果把 Key 直接写在网页代码里，任何人打开浏览器"查看网页源代码"都能看到并盗用你的Key，
消耗你的额度。所以必须有一层后端，把 Key 藏在服务器环境变量里，前端只跟你自己的后端说话。

## 第一步：申请 Eachlabs 的 API Key

1. 打开 https://www.eachlabs.ai 注册账号
2. 进入 Settings → API Keys，创建一个 Key
3. 单次调用大约 $0.04（约0.3元人民币），建议先充值小额测试，比如10-20美元

## 第二步：本地跑起来看看

需要电脑上装好 Node.js（18版本以上），然后：

```bash
cd hairstyle-backend
npm install
cp .env.example .env
```

打开 `.env` 文件，把 `EACHLABS_API_KEY` 换成你自己申请的Key，然后：

```bash
npm start
```

看到 `✅ 服务已启动` 说明跑起来了，但注意：**这时候只能自己电脑访问，Eachlabs的服务器没办法访问你电脑上的图片**，
所以 `/api/generate-hairstyle` 这个接口在纯本地环境下会报错（因为它需要把图片地址传给 Eachlabs，Eachlabs 要去这个地址下载图片，
而 `localhost` 这个地址只有你自己电脑能访问）。

如果只是想在本地先验证代码有没有语法错误、接口通不通，这样跑起来就够了。
如果想在本地就看到真实生成效果，需要用 `ngrok` 这类内网穿透工具，把本地地址临时映射成一个公网地址，
然后把这个地址填到 `.env` 的 `PUBLIC_BASE_URL` 里，重启服务。

## 第三步：正式部署上线（推荐直接跳到这一步）

比起本地折腾，更省事的做法是直接部署到一个有公网地址的平台，免费额度够小规模测试用。推荐 **Render.com**：

1. 把这个 `hairstyle-backend` 文件夹上传到你的 GitHub（新建一个仓库，把文件推上去）
2. 打开 https://render.com ，注册账号，选择 "New Web Service"，关联你刚才的GitHub仓库
3. Build Command 填 `npm install`，Start Command 填 `npm start`
4. 在 Render 的环境变量设置里，添加：
   - `EACHLABS_API_KEY` = 你的Key
   - `PUBLIC_BASE_URL` = 部署成功后 Render 分配给你的那个地址（形如 `https://xxx.onrender.com`，先随便填一次部署完拿到真实地址后再改一次并重新部署）
5. 部署完成后，你会拿到一个类似 `https://hairstyle-backend-xxxx.onrender.com` 的公网地址

## 第四步：把这个地址填回前端页面

打开 `hairstyle-preview-demo.html`，找到最上面 `<script>` 里的这一行：

```javascript
const API_BASE = 'http://localhost:3000'; // ← 部署好后端后，把这里换成你的后端公网地址
```

换成你在第三步拿到的那个地址（不要加最后的斜杠），保存后重新部署/上传前端页面即可。

## 关于隐私，务必注意

- 用户上传的照片会被临时保存在你服务器的 `public/uploads` 文件夹，**30分钟后自动删除**（代码里已经写了这个逻辑），
  不会长期保留，这是为了降低隐私风险，但你仍然需要在网站上明确告知用户"照片会发送给AI服务商用于生成，处理后短时间内自动删除"。
- 照片本身也会经过 Eachlabs 的服务器处理，这是调用第三方AI服务不可避免的，需要在隐私说明里如实告知用户。
- 建议正式对外大规模使用前，找懂数据合规的人把隐私政策过一遍（之前也提到过这一点）。

## 关于成本

假设一个用户体验一次要生成4个风格方向，大约 `4 × $0.04 ≈ $0.16`（约1.1元人民币）。
小额付费测试阶段这个成本完全可控，但记得在后台留意 Eachlabs 账户余额，避免中途没额度导致网站生成失败。
