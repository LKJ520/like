# Vercel 部署

1. 登录 Vercel，进入 `Add New -> Project`
2. 导入当前这个目录对应的仓库
3. 在 `Environment Variables` 里添加：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_BUCKET=love-page-photos`
   - `SUPABASE_TABLE=gallery_photos`
4. 点 `Deploy`

部署成功后，Vercel 会给你一个 `https://*.vercel.app` 地址。

## 注意

- `SUPABASE_SERVICE_ROLE_KEY` 只能放在 Vercel 后端环境变量里
- 不要把它写进 `index.html`
- 如果你重新生成了 Supabase 密钥，记得同步更新 Vercel 环境变量

