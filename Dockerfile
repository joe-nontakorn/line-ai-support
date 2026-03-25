FROM oven/bun:latest

WORKDIR /app

# คัดลอกไฟล์จัดการ package ก่อนเพื่อใช้ประโยชน์จาก Layer Cache
COPY package.json bun.lock ./
RUN bun install

# คัดลอกโค้ดทั้งหมด
COPY . .

# สั่งรันแอป
CMD ["bun", "run", "src/app.js"]