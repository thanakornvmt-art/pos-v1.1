# ระบบ POS โจ๊ก–ต้มเลือดหมู

Next.js 14 App Router, TypeScript strict, Tailwind + shadcn/ui (Radix), PostgreSQL + Prisma, NextAuth Credentials/PIN, Zustand, TanStack Query, Dexie, Zod, Vitest และ Playwright

ธีมเหลืองทอง / ดำถ่าน / ครีม อ้างอิงสีจากภาพที่ผู้ใช้ให้ ปุ่มสัมผัสขั้นต่ำ 64px และตะกร้า/ชำระเงินติดขอบจอ เหมาะกับแท็บเล็ตแนวนอนตั้งแต่ 1024×768

## เริ่มใช้งานในเครื่อง

ต้องมี Node.js 20.19+ และ pnpm หากใช้ Windows ในเครื่องที่ไม่มี PostgreSQL สามารถใช้ฐานข้อมูลพกพาที่แยกไว้ใน `.local/postgres`:

```sh
pnpm install
pnpm setup:local
pnpm db:local
```

เปิดอีก terminal ในโฟลเดอร์เดียวกัน:

```sh
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm build
pnpm start
```

เปิด http://localhost:3000/login ฐานข้อมูลพกพาฟังเฉพาะ 127.0.0.1:54329 และมีไว้พัฒนาเท่านั้น หากใช้ Docker ให้ใช้ `docker compose up -d` แล้วใช้ DATABASE_URL จาก `.env.example` แทน

`setup:local` สร้าง secret แบบสุ่มและไม่ทับ .env ที่มีอยู่ การ seed ต้องกำหนด SEED_DEMO=true และจะข้ามเมื่อมี Settings อยู่แล้ว ไม่ลบหรือทับข้อมูลธุรกรรม

## การเอาขึ้นออนไลน์ให้คนอื่นทดลอง

โปรเจกต์พร้อม deploy บน Vercel ร่วมกับ PostgreSQL ออนไลน์ เช่น Neon หรือ Supabase แล้ว ดูขั้นตอนเต็มได้ที่ [DEPLOYMENT.md](./DEPLOYMENT.md)

ค่าที่ต้องตั้งบนโฮสต์คือ `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET` และ `SEED_DEMO=true` สำหรับฐาน demo เท่านั้น ก่อนรัน migration/seed บนฐานออนไลน์ให้ตรวจด้วย `pnpm deploy:check` จากนั้นรัน `pnpm deploy:migrate` และ `pnpm deploy:seed`

บัญชีทดลอง:

| ผู้ใช้ | PIN | สิทธิ์ |
|---|---|---|
| เจ้าของร้าน | 1234 | ขาย จัดการ รายงาน |
| แคชเชียร์ | 2345 | ขาย เดลิเวอรี่ |
| ครัว | 3456 | คิวครัว ไม่มีสิทธิ์รับชำระ/สต็อก/รายงาน |

ข้อมูลเริ่มต้นมี 4 หมวด 12 เมนู 16 วัตถุดิบ 2 สูตรย่อย 5 กลุ่มตัวเลือก 3 ผู้ใช้ เป็นข้อมูลทดลองทั้งหมด ราคาบันทึกใน MenuPrice, ค่าร้าน/ภาษี/PromptPay ใน Settings และ GP ใน ChannelSetting

## หน้าจอ

- `/login` เลือกผู้ใช้ + PIN 4 หลัก ผิด 5 ครั้งพัก 15 นาที การเข้าใช้ครั้งแรกต้องออนไลน์
- `/pos` ขาย เมนู/ตัวเลือก ช่องทาง พักบิล แยกตามจำนวน รวมบิลที่ยังไม่ชำระและช่องทางเดียวกัน ยืนยันก่อนลบ/ล้าง/รวม/แยก
- ชำระเงินผ่าน dialog จาก POS: เงินสด ปุ่มแบงก์/พอดี เงินทอน 48px, PromptPay EMV QR ตามยอด, บัตร/COD พร้อมเลขอ้างอิงและยืนยันรับเงิน, ส่วนลดบาท/% พร้อมเหตุผลและ audit
- `/print` คิวถาวรแยกครัว/ลูกค้า เปิด browser print แล้วผู้ใช้ยืนยันว่าพิมพ์แล้ว
- `/manage` วัตถุดิบ/หน่วย/yield/Par/Reorder, สูตรซ้อน, BOM, ต้นทุนสดทุกช่องทาง, Food cost เตือนเกิน 40%, ราคาแนะนำ 35% และชดเชย GP ต้องยืนยันก่อนบันทึก, CSV, ซัพพลายเออร์และ Settings
- `/stock` รับเข้า/ต้นทุนเฉลี่ย นับพร้อมผลต่างจำนวนและเงิน ของเสีย 4 เหตุผล ล็อตหมดอายุ Dashboard ใบสั่งซื้อฉบับร่าง Ledger ลิงก์บิล
- `/delivery` คีย์ออเดอร์พร้อมเลขอ้างอิง Kanban สีแยกช่องทาง เปิดรับชำระและปิดขายเมนูชั่วคราว อัปเดตทุก 3 วินาที
- `/kitchen` คิวครัวจากบิล POS และแพลตฟอร์ม เปลี่ยนสถานะได้โดยไม่มีสิทธิ์เข้าข้อมูลการเงิน
- `/reports` เจ้าของเท่านั้น ช่วงวันที่ ยอดรายวัน/ชั่วโมง Top/Bottom Food cost กำไรแยกกลุ่ม ของเสีย/นับสต็อก ปิดร้านและ CSV
- `/orders/[client_uuid]` เจ้าของดูบิล/ยกเลิกพร้อมเหตุผล สร้าง stock reversal และบันทึกการคืนเงิน ไม่ลบข้อมูลเดิม

## สถาปัตยกรรม

```text
prisma/                  schema, migrations พร้อม DB checks, seed
src/app/                 หน้าจอและ Route Handlers
src/components/ui/       shadcn-style Button, Radix Dialog
src/components/pos/      options, payment, runtime/connection
src/domain/              Zod, pricing, BOM recursion, WAC, EMV QR, reports
src/lib/                 auth, catalog snapshot, signed permit, transaction
src/lib/offline/         Dexie tables, atomic checkout, durable replay
src/stores/              Zustand draft state
public/                  SW, precache, manifest, local SVG menu assets
tests/unit/              คำนวณเงิน สูตร และ offline queue
tests/e2e/               เบราว์เซอร์และ PostgreSQL transaction tests
```

### เงินและต้นทุน

เงินขายเป็น integer สตางค์ อัตรา GP/ภาษี/% เป็น basis points (100 = 1%) ปริมาณและต้นทุนต่อหน่วยใช้ Decimal ห้ามคำนวณเงินด้วย float ปัด HALF_UP เมื่อต้องบันทึกสตางค์เต็ม และปันส่วนต้นทุน/รับสุทธิให้ผลรวมรายบรรทัดเท่ากับบิล

สต็อกนับเป็น **หน่วยที่ใช้งานได้หลัง yield**: ปริมาณรับได้ = หน่วยซื้อ × conversion × yield/100; ต้นทุนหน่วยใช้ = มูลค่าซื้อ ÷ ปริมาณรับได้ การรับเข้าคำนวณ WAC ใหม่ใน transaction กรณีสต็อกติดลบจากการขายออฟไลน์ ใช้ยอดเดิมศูนย์เป็นฐาน WAC สำหรับการรับครั้งถัดไป

BOM ใช้หน่วยของ ingredient หรือ outputUnit ของ sub-recipe เสมอ คลี่ซ้อนด้วย qty/outputQty ตรวจ cycle ทั้งกราฟก่อนบันทึก บรรจุภัณฑ์แยกตามเมนู/ช่องทางและถูกตัดอัตโนมัติเมื่อชำระ ไม่คิดหัก yield ซ้ำขณะขาย

รายงานกำไรใช้ต้นทุนที่บันทึกขณะ sync ไม่เปลี่ยนย้อนหลังตามราคาซื้อใหม่ Food cost รายเมนูใช้ยอดก่อนส่วนลด/ภาษี ส่วนกำไรใช้ net payout หลัง GP ลบอาหารและบรรจุภัณฑ์ รายงานยอดขายไม่นับบิลยกเลิก เงินสดคืนใช้วันที่ยกเลิก

### Offline-first

1. ออนไลน์ครั้งแรกออก signed permit ผูก user/device/catalog เวลาขายเริ่มต้น 12 ชั่วโมง
2. เก็บ CatalogSnapshot ที่ immutable บน server และ cache catalog ใน IndexedDB เพื่อรักษาราคา/สูตรของบิลที่สร้างออฟไลน์
3. บิลพักเก็บชุดราคาและ permit ของตัวเอง ชำระสำเร็จเขียน Order + sequence + งานพิมพ์ 2 ชุด + เคลียร์ draft ใน **IndexedDB transaction เดียว** ก่อนเรียก server
4. เลขบิลใช้ UUID ของอุปกรณ์เต็ม + sequence ที่เพิ่มแบบ atomic; client_uuid เป็น idempotency key
5. API ตรวจ permit/ยอด/ตัวเลือก จาก snapshot แล้วสร้างบิล Payment, StockMovement, AuditLog และปรับ stock ใน PostgreSQL Serializable transaction พร้อม retry
6. บิลไม่สำเร็จอยู่ในเครื่องและแสดง error ไม่ลบทิ้ง Online event/ตัวจับเวลา replay ให้ งานพิมพ์เปลี่ยนเป็น ready หลัง server ยืนยัน แต่เปิด preview ระหว่างออฟไลน์ได้
7. SW precache app shell + JS/CSS จาก production build และเมนู/ภาพ local ทั้งหมด การ reload offline ต้องเคยเข้าออนไลน์และเตรียม cache สำเร็จก่อน

Server เป็นเจ้าของ stock, client เป็นเจ้าของบิลที่มี signed snapshot การขายออฟไลน์อาจทำให้สต็อกติดลบได้และแสดงเตือน ต้องนับปรับหลัง sync ไม่แก้บิลย้อนหลังเงียบ ๆ อุปกรณ์ที่ถูกล้าง IndexedDB จะได้ device UUID ใหม่ ห้ามล้าง browser data ขณะมีบิลรอส่ง

งานพิมพ์เก็บ UUID คงที่และไม่อ้างว่าการเปิด print dialog คือพิมพ์สำเร็จ ยังไม่มีเครื่องพิมพ์จริงหรือ silent print bridge เชื่อมต่อ งานจะค้างจนผู้ใช้ยืนยัน

### สต็อกและการตรวจสอบ

ทุก stock mutation อยู่ใน DB transaction รวม stock batch allocation; SALE/WASTE ตัดล็อตวันหมดอายุใกล้ก่อน Void คืน allocation เดิม RECEIVE/COUNT/WASTE มี operation UUID/hash กัน replay Count ตรวจยอดระบบเดิมเพื่อป้องกันการใช้ยอดนับเก่าทับการขายใหม่ Serializability ใช้ป้องกัน lost update

การปิดใช้งานวัตถุดิบเป็น soft archive และทำไม่ได้หากยังถูกใช้ในสูตร หน่วยของวัตถุดิบที่สร้างแล้วไม่ให้เปลี่ยน เพื่อรักษาหน่วย ledger เก่า

ใบสั่งซื้อ: ใช้ 7 วันเต็มตาม Asia/Bangkok ตั้งเป้าสูงกว่าระหว่าง Par และเฉลี่ยใช้ × (วันเผื่อ+วันส่ง) หักยอดมี แล้วหาร conversion/yield และปัดขึ้นหน่วยซื้อ เป็นฉบับร่าง ไม่ส่งภายนอก วันเผื่อ = **2 วัน** ตามคำยืนยันผู้ใช้ ส่วนวันรอส่งยังว่าง จึงต้องตั้งก่อนสร้างใบสั่งซื้อ

## การตั้งค่าที่ยังต้องใช้ข้อมูลจริง

- PromptPay ID ยังไม่กำหนด จึงไม่สร้าง QR ไปยังเลขบัญชีสมมติ ตั้งผ่าน `/manage` ก่อนใช้
- การชำระ PromptPay/บัตร/COD เป็นการยืนยันโดยพนักงาน ไม่มี bank webhook หรือ automatic reconciliation; countdown เป็นเวลาใน UI ไม่สามารถเพิกถอน EMV QR ที่ธนาคารได้
- COD ที่ยังไม่ได้เงินเก็บเป็นบิลพัก/DeliveryTicket และไม่ตัดสต็อก ยืนยันรับเงินเมื่อเก็บได้แล้ว
- แพลตฟอร์มเดลิเวอรี่ใช้การคีย์ข้อมูล ไม่ได้เชื่อม API Grab/LINE MAN/Shopee ปุ่มของหมดมีผลในระบบร้านทุกช่องทางออนไลน์ อุปกรณ์ออฟไลน์รับสถานะใหม่เมื่อเชื่อมต่อ
- วันรอส่งซัพพลายเออร์ยังต้องกรอก
- รายงานเงินสดครอบคลุมเงินเปิดลิ้นชัก ยอดรับ และคืนเงิน ไม่รวม cash-in/out อื่น การยกเลิกบิลบันทึกการคืนเงิน ต้องคืนเงินจริงผ่านช่องทางเดิมโดยพนักงาน
- บิลที่เกินเวลารับ sync (ค่าเริ่มต้น 7 วันหลัง permit หมดอายุ) จะเก็บไว้ในเครื่องพร้อม error ให้เจ้าของตรวจ

## ทดสอบ

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Playwright ใช้ Chrome ที่ติดตั้งใน Windows กำหนด CHROME_PATH เพื่อเปลี่ยน path และ TEST_BASE_URL เพื่อเปลี่ยน URL ทดสอบ ต้อง seed ฐานข้อมูลทดสอบก่อน ทดสอบ `transactions.spec.ts` ต้องกำหนด DATABASE_URL ไปที่ฐานข้อมูลทดสอบ ห้ามรันกับข้อมูลร้านจริง

การทดสอบฐานข้อมูลแยกที่ใช้ในงานนี้คือ `morning_pos_test` สร้างด้วย `node scripts/test-db.mjs`, migrate/seed ด้วย DATABASE_URL ที่ชี้ test DB แล้วเริ่ม app port 3001 ด้วย NEXTAUTH_URL/TEST_BASE_URL=http://localhost:3001

## ก่อนใช้ในร้านจริง

ต้องเปลี่ยน PIN ทดลอง, ตั้ง HTTPS สำหรับแท็บเล็ต/PWA, เตรียม backup และทดสอบกับอุปกรณ์/เครื่องพิมพ์จริง ยังไม่ได้รับรอง SLA หรือ throughput 350 บิล/วันจาก load test

คง Next.js 14.2.35 ตามข้อบังคับของผู้ใช้ แต่ Next.js 14 อยู่นอกช่วง LTS ที่รองรับแล้ว ควรตกลงอัปเกรดก่อนเปิดสู่สาธารณะ: [Next.js Support Policy](https://nextjs.org/support-policy)

## จัดการร้านและรูปเมนู

เจ้าของเปิดตั้งค่าร้าน `/settings` และจัดการพนักงาน `/employees` จากแถบซ้ายได้ เพิ่มบัญชี เลือกสิทธิ์ ตั้ง PIN 4 หลัก เปลี่ยน PIN และเปิด/ปิดบัญชี มีการยืนยันและ audit log โดยไม่เก็บ PIN ใน log การเปลี่ยน PIN/สิทธิ์ทำให้ session เก่าใช้ API ต่อไม่ได้เมื่อออนไลน์ เครื่องออฟไลน์ต้องกลับมาเชื่อมต่อจึงรับรู้สิทธิ์ใหม่

รูปเมนู: สูตรและต้นทุน → รูปเมนู → เพิ่ม / เปลี่ยนรูป รองรับ JPG/PNG/WebP ไม่เกิน 10 MB ย่อด้านยาวไม่เกิน 1024 px และแปลง JPEG ก่อนส่ง ภาพเก็บใน PostgreSQL ตาราง menu_images (ต้องรวมใน backup) URL เปลี่ยนทุกครั้งเพื่อไม่ติดรูปเก่า แคชออฟไลน์หลังรับข้อมูลล่าสุด เก็บภาพเก่าไว้เพื่อบิล/แคชเดิม การเอารูปออกไม่ลบไฟล์เดิม

คู่มือ SOP: output/pdf/SOP-POS-Thai.pdf (14 หน้า)
