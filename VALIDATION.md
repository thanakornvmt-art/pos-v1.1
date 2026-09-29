# ผลตรวจสอบล่าสุด — 27 กันยายน 2569

## Deploy production — 27 กันยายน 2569

- URL: https://pos-v1-1.vercel.app — deployment `dpl_yFtaBiQWWKUzpv75L9pyWGoKuRrc` สถานะ READY; build บน Vercel 1 นาที 20 วินาที
- ใช้โค้ดจาก workspace รวมไฟล์ใหม่ที่ยังไม่ commit ผ่าน Vercel CLI; ไม่ได้ push GitHub
- สำรองฐานออนไลน์ก่อนเปลี่ยนแปลง: `.local/backups/before-production-deploy-20260927.dump` พร้อม SHA256 manifest; กู้ไปฐานใหม่ในเครื่องและทดลอง migration ผ่าน จำนวนบิล/ผู้ใช้/วัตถุดิบ/stock movements ตรงกันก่อนและหลัง
- Apply migration `20260927170000_audit_timeline` บน production แล้ว (เพิ่ม index ประวัติรายการ)
- ตรวจ deployment ใหม่ก่อนสลับโดเมน: `/api/health` ตอบ ok; promote แล้วตรวจ canonical URL ว่าชี้ deployment ใหม่
- ตรวจเว็บจริงผ่าน: เข้าสู่ระบบเจ้าของ, session, bootstrap โดยใช้ device เดิม, API บิลเก่า/ใบเสร็จ/stock shortages/audit/reports/print settings และหน้าขาย/บิลเก่า/คิวพิมพ์ ตอบ 200; ผู้ไม่เข้าสู่ระบบเรียกบิลเก่าได้ 403
- ตรวจ log deployment ช่วง 15 นาทีหลังขึ้นระบบ ไม่พบรายการ HTTP 5xx ณ เวลาตรวจ
- ไม่ทำรายการขาย/แก้บิล/พิมพ์กระดาษจริงบน production ใน smoke check นี้; ผลธุรกรรมและ BLE จำลองอยู่ในส่วนทดสอบด้านล่าง
- หลักฐานตรวจออนไลน์: `.local/deploy-smoke-20260927.json`; ไฟล์สำรองและ credentials ไม่อยู่ในไฟล์ที่ upload ทั้ง 167 ไฟล์

## เพิ่มพิมพ์อัตโนมัติ บิลเก่า และแก้บิลหลังรับเงิน

- รอบพัฒนานี้หยุด deploy ตามคำสั่งผู้ใช้ก่อน จากนั้นได้รับคำสั่ง deploy ใหม่และดำเนินการตามผลด้านบน ฟังก์ชันบิล/พิมพ์ไม่เพิ่ม migration
- Unit 43/43 ผ่าน; Next.js production build และ TypeScript ผ่าน; precache เพิ่มเป็น 85 assets และเพิ่ม `/orders` ให้เปิดจาก cache ได้
- รอบ E2E รวม 39 กรณี ผ่าน 38 และพบพื้นที่เมนูแคบบนมือถือแนวนอน 667×375 จึงย้ายแถบพิมพ์/บิลเก่าเข้าในพื้นที่เลื่อนเมนู
- หลังแก้ ทดสอบส่วนที่ได้รับผลอีกครั้ง **19/19 ผ่าน** ได้แก่หน้าขาย บิลเก่า/การแก้บิล พิมพ์ และหน้าจอทั้ง 6 ขนาด; อีก 20 กรณีผ่านจากรอบรวมก่อนหน้า
- ทดสอบจริงบน PostgreSQL แยก: owner-only amendment, cashier/anonymous rejection, total validation, duplicate concurrent requests, stale correction rejection, old offline replay, stock reversal once, receipt reprint without new sale และรับ/คืนเงินส่วนต่างผ่าน UI
- BLE จำลอง: รับเงินเมื่อส่งบิลไม่ได้ยังส่งใบเสร็จอัตโนมัติ การเปลี่ยนหน้าไม่ตัดการเชื่อมต่อ และไม่พิมพ์ซ้ำหลังเปลี่ยนหน้าหรือ reload; ยังต้องลองกระดาษ/อุปกรณ์จริง
- ตรวจฐานร้าน `morning_pos`: บิล เมนู วัตถุดิบยังเป็น 0; บัญชี `test` เป็น OWNER และ active

## ผล audit และ backup ก่อนเพิ่มฟังก์ชันรอบนี้

ผลนี้เป็นการตรวจโค้ดในเครื่องกับฐาน `morning_pos_test_readiness` และ production server ที่ `http://127.0.0.1:3101` ไม่ใช่ผลตรวจ deployment ออนไลน์

- Production build: ผ่าน Next.js 16.3.6 / React 19.3.0 / Prisma 6.19.3; precache 81 assets
- TypeScript: ผ่าน `tsc --noEmit`; migration ทั้ง 7 ชุดตรงกับฐานทดสอบ
- Vitest: **43/43 ผ่าน**; Node backup guard tests: **2/2 ผ่าน**
- Playwright + PostgreSQL: **36/36 ผ่าน** ในรอบสุดท้าย (2.3 นาที)
- Dependency audit ฝั่ง production: **ไม่พบช่องโหว่ที่มีรายงาน** ณ เวลาตรวจ
- สำรองและกู้คืนจริง: **32 ตารางตรงกันทุกตาราง** ทั้งจำนวนแถวและ fingerprint ของข้อมูล หลังหยุด server ทดสอบ; ใช้เวลา 5.577 วินาที และตรวจว่าปฏิเสธการ restore ทับฐานที่มีข้อมูล
- หลักฐาน restore ภายในเครื่อง: `.local/backups/restore-drill-1790504594359.dump.verification.json` พร้อม archive และ checksum manifest; ไฟล์เหล่านี้ไม่ถูกนำเข้า Git

รอบนี้ครอบคลุมขาย/รับเงิน/ยกเลิก, concurrent sync และ idempotency, offline reload, สต็อกขาดจากบิลที่รับเงินแล้ว, การแจ้งเจ้าของ, สิทธิ์พนักงาน, audit pagination และการปกปิด credential, รายงาน 9 มุมมองและ CSV, หน้าจอ 6 ขนาด และการพิมพ์ผ่านอุปกรณ์จำลอง

ฐานร้านในเครื่อง `morning_pos` ยังคงว่างตามคำสั่งล้างก่อนหน้า: เมนู วัตถุดิบ บิล และ stock movements เป็น 0; คงผู้ใช้เดิม 3 บัญชี การตรวจครั้งนี้ไม่เพิ่มข้อมูลทดลองกลับเข้าไป

ข้อจำกัด: ยังไม่ได้ deploy/push หรือรัน GitHub Actions บน GitHub, ยังไม่ได้ทดสอบเครื่องพิมพ์จริง, ตั้ง backup ออนไลน์อัตโนมัติ/ยืนยัน Neon PITR, ทดสอบบน URL ร้านจริง หรือทดลองขายต่อเนื่องทั้งวัน ดูลำดับงานก่อนเปิดขายใน `PRODUCTION-READINESS.md` และวิธีกู้คืนใน `BACKUP-RESTORE.md`

---

# ผลตรวจสอบรอบส่งมอบ 20 กันยายน 2569 (ประวัติ)

- TypeScript strict: ผ่าน `tsc --noEmit`
- Prisma Client และ migrations 3 ชุด: สร้างและใช้กับ PostgreSQL จริงผ่าน
- Production build: ผ่าน Next.js 14.2.35 พร้อม precache 50 assets รวมฟอนต์ไทย
- Vitest: **14/14 ผ่าน**
- Playwright + PostgreSQL: **10/10 ผ่าน**

กรณีสำคัญที่ตรวจแล้ว:

1. เงินสตางค์ ส่วนลด GP การปันส่วนต้นทุนไม่ทำยอดรวมเพี้ยน
2. สูตรซ้อนหลายชั้น รวม ingredient ซ้ำ และปฏิเสธ circular reference
3. yield และ weighted average cost
4. IndexedDB transaction เก็บบิล งานพิมพ์สองชุด และเลขลำดับพร้อมกัน
5. กดชำระซ้ำไม่สร้างบิลซ้ำ สิทธิ์หมดอายุ/บิลเปลี่ยนจากอีกหน้าต่างถูกปฏิเสธ
6. Reload offline แล้วยังขายได้ กลับออนไลน์แล้ว replay ได้
7. PostgreSQL รับ sync พร้อมกันไม่ตัดสต็อกซ้ำ และยกเลิกพร้อมกันคืนสต็อกครั้งเดียว
8. รับของ replay ไม่เพิ่มสต็อกซ้ำ และ count จากยอดเก่าถูกปฏิเสธ
9. แก้ options ในรายการเดิม แยก/รวมบิล และส่วนลดพร้อมเหตุผล
10. PromptPay QR แสดงยอดจริงและไม่ยืนยันเงินเข้าอัตโนมัติ
11. ช่องทางแพลตฟอร์มไม่ตัด stock ก่อนรับเงิน และรับชำระเชื่อมกลับ ticket ได้
12. สิทธิ์แคชเชียร์/ครัวเข้ารายงานเจ้าของไม่ได้
13. ปุ่มชำระอยู่ใน viewport 1024×768 และ 768×1024

การทดสอบธุรกรรมใช้ฐานข้อมูล `morning_pos_test` แยกจากฐานข้อมูลร้านทดลอง

ภาพหน้าจอ: `artifacts/pos-tablet.png`, `artifacts/promptpay-tablet.png`

ยังไม่ทดสอบเครื่องพิมพ์จริง การยืนยันรับเงินจากธนาคาร API แพลตฟอร์ม และ load/soak test ต่อเนื่องทั้งวัน จึงยังไม่ใช่ผลรับรองพร้อมเปิดใช้กับข้อมูลร้านจริง

## อัปเดต 20 กันยายน 2569

- Production build และ TypeScript ผ่าน; migration 5 ชุดใช้กับฐานข้อมูล demo/test แล้ว
- Vitest 14 tests ผ่าน; Playwright 13 tests ผ่านกับ morning_pos_test
- ทดสอบเพิ่มพนักงาน, PIN ไม่ตรงกัน, เปลี่ยน PIN, ยกเลิก session เก่า, ปิดบัญชี, ป้องกันปิดเจ้าของตนเอง และ audit ไม่บันทึก PIN
- ทดสอบอัปโหลดรูปจริงผ่าน UI, เก็บและเสิร์ฟ JPEG, cache รูปและอ่านเมื่อออฟไลน์, เอารูปออกพร้อมยืนยัน และปฏิเสธข้อมูลรูปปลอม
- SOP 14 หน้า render PNG และตรวจหน้าเอกสารครบ ไม่มีเนื้อหาทับ footer
