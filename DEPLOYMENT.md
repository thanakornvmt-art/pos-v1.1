# Online demo deployment

คู่มือนี้ใช้สำหรับเอา Morning POS ขึ้นออนไลน์ให้คนอื่นทดลองใช้ผ่าน Vercel และ PostgreSQL ออนไลน์ เช่น Neon หรือ Supabase

## 1. สร้างฐานข้อมูล PostgreSQL ออนไลน์

สร้าง database ใหม่ แล้วเก็บ connection string ไว้ 2 ค่า

- `DATABASE_URL` สำหรับ runtime ของเว็บ แนะนำให้ใช้ pooled connection ถ้าผู้ให้บริการมีให้
- `DIRECT_URL` สำหรับ Prisma migration ให้ใช้ direct connection

ถ้าผู้ให้บริการมี URL เดียว สามารถใช้ค่าเดียวกันทั้งสองตัวสำหรับ demo ขนาดเล็กได้

## 2. ตั้งค่า environment variables บน Vercel

ตั้งค่าต่อไปนี้ใน Project Settings > Environment Variables

```env
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."
NEXTAUTH_URL="https://your-project.vercel.app"
NEXTAUTH_SECRET="random-string-at-least-32-characters"
SEED_DEMO="true"
```

สร้าง secret ได้ด้วยคำสั่งนี้ในเครื่องตัวเอง

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

## 3. Deploy เว็บ

นำโปรเจกต์ขึ้น GitHub แล้ว Import เข้า Vercel

Build command:

```bash
pnpm build
```

Vercel จะใช้คำสั่งใน `package.json` ซึ่งรัน `prisma generate`, `next build` และสร้าง precache ให้ service worker

## 4. สร้างตารางและ seed demo data

ก่อนเปิดเว็บให้ทดลอง ให้รันคำสั่งต่อไปนี้โดยใช้ environment ของ production/demo

```bash
pnpm deploy:check
pnpm deploy:migrate
pnpm deploy:seed
```

Seed จะทำงานเมื่อ `SEED_DEMO=true` และจะข้ามทันทีถ้ามีข้อมูลร้านอยู่แล้ว เพื่อไม่ทับข้อมูลจริง

ฐานข้อมูลออนไลน์ต้องกำหนด `SEED_OWNER_PIN`, `SEED_CASHIER_PIN` และ `SEED_KITCHEN_PIN` เป็น PIN 4 หลักใหม่ใน environment ของคำสั่ง seed ด้วย ระบบจะไม่ใช้ PIN ตัวอย่างในเครื่องกับฐานข้อมูลออนไลน์ เก็บ PIN เหล่านี้เป็นความลับ และไม่จำเป็นต้องใส่ไว้ใน environment ของเว็บหลัง seed เสร็จ

## 5. ก่อนส่งลิงก์ให้คนอื่น

เข้าเว็บด้วยบัญชีเจ้าของร้าน แล้วทำสิ่งนี้ก่อนแจก URL

- เปลี่ยน PIN เจ้าของร้านและพนักงานทั้งหมดในหน้า `พนักงาน`
- ตั้งชื่อร้าน, PromptPay ID, GP% และ lead time supplier ในหน้า `ตั้งค่าร้าน`
- ทดสอบขาย 1 บิล, PromptPay QR, offline/online sync และ export รายงาน CSV

## หมายเหตุสำหรับ demo

ระบบยังไม่มีการเชื่อมต่อธนาคาร, แพลตฟอร์มเดลิเวอรี่ หรือเครื่องพิมพ์จริง PromptPay ใช้ QR ตามยอดเพื่อให้พนักงานตรวจยอดเอง และคิวพิมพ์ใช้ browser print ตามที่ระบบรองรับอยู่แล้ว
