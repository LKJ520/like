# Supabase 相册配置

这个页面现在通过 `Vercel API + Supabase` 保存照片和视频。别人打开网站时，能从 Supabase 读到同一份公共相册。

## 1. 创建存储桶

在 Supabase 控制台创建一个公开存储桶：

- 桶名：`love-page-photos`
- 公开访问：开启

## 2. 创建数据表

在 SQL Editor 执行：

```sql
create table if not exists public.gallery_photos (
  id uuid primary key,
  name text not null,
  storage_path text not null unique,
  owner_token text not null,
  created_at timestamptz not null default now()
);

create index if not exists gallery_photos_created_at_idx
  on public.gallery_photos (created_at asc);
```

## 3. 配置 Vercel 环境变量

在 Vercel 项目里设置：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_BUCKET`，可选，默认是 `love-page-photos`
- `SUPABASE_TABLE`，可选，默认是 `gallery_photos`

## 4. 部署后效果

- 上传照片或视频会先到 `/api/photos`
- 照片由 API 写入 Supabase Storage 和表
- 视频由 API 签发 Supabase 直传地址，浏览器直传视频和封面图到 Storage 后再写入表
- 页面重新打开时，会自动拉回全部公开照片和视频
- 只有本浏览器里上传过的内容，才会显示删除权限

