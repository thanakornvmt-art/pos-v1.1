# สำรองและกู้คืนข้อมูล POS

สำรอง PostgreSQL ครบทั้ง schema/data รวมรูปเมนู สูตร พนักงาน บิล สต็อก และ audit log ด้วย `pg_dump` แบบ custom archive
ไฟล์นี้มีข้อมูลส่วนตัวและ PIN hash: เก็บในที่จำกัดสิทธิ์และเข้ารหัส ห้าม commit หรือส่งผ่านแชท

## เตรียมครั้งแรก

- ติดตั้ง PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`) รุ่นเดียวกับหรือใหม่กว่า server; ระบุ `PG_BIN` หากไม่ได้อยู่ใน PATH
- ใช้ direct connection ของ Neon สำหรับ backup ไม่ใช้ pooler
- กำหนด `BACKUP_DATABASE_URL` ใน environment/secret manager ของผู้รันโดยตรง สคริปต์ไม่โหลด `.env` อัตโนมัติ
- หยุดขายและซิงก์บิลค้างจาก **ทุกเครื่อง** ก่อนเก็บสำเนาสำหรับย้ายระบบ; บิลที่ยังอยู่ใน IndexedDB ไม่อยู่ใน backup PostgreSQL

## สำรอง

```text
node scripts/database-backup.mjs backup .local/backups/pos-YYYY-MM-DD.dump
```

คำสั่งปฏิเสธชื่อไฟล์ที่มีอยู่แล้ว ตรวจ archive และสร้าง manifest SHA-256 ข้างไฟล์
ไฟล์ `.partial` หรือไฟล์ไม่มี manifest **ไม่ใช่ backup ที่สำเร็จ** ต้องรันใหม่ด้วยชื่อใหม่
ตั้งเวลาในระบบที่เก็บ secrets ได้ให้ทำทุกคืนและก่อน migration; ส่ง archive + manifest ไปที่เก็บเข้ารหัสนอกเครื่อง
เก็บรายวัน 30 วันและรายเดือน 12 ชุดตามพื้นที่ที่จัดสรร ตั้งเตือนเมื่อคำสั่งไม่สำเร็จหรือไม่มี backup ใหม่ภายใน 24 ชั่วโมง
เป้าหมายเริ่มต้น: สูญหายไม่เกิน 24 ชั่วโมง (RPO) และกู้ได้ภายใน 2 ชั่วโมง (RTO); ต้องจับเวลาซ้อมจริงก่อนยืนยัน

## กู้ลงฐานใหม่เท่านั้น

1. สร้างฐาน PostgreSQL ว่าง/Neon branch แยกที่ไม่มีตารางแอป ห้ามใช้ฐานร้านที่กำลังขาย
2. กำหนด `RESTORE_DATABASE_URL` และ `RESTORE_CONFIRM_DATABASE` เป็นชื่อฐานปลายทางตรงตัว
3. เก็บ `BACKUP_DATABASE_URL` ไว้ด้วยเพื่อให้สคริปต์ตรวจว่าเป็นคนละฐาน
4. รัน `node scripts/database-backup.mjs restore .local/backups/pos-YYYY-MM-DD.dump`
5. คำสั่งตรวจ checksum และปฏิเสธฐานที่มีตารางอยู่แล้ว; กู้ทั้งก้อนใน transaction ไม่มี `--clean`/ลบฐานเดิม
6. ใช้แอปสำเนาชี้ฐานที่กู้ ตรวจจำนวนและยอดรวมบิล เมนู สูตร วัตถุดิบ รูปเมนู บิลยกเลิก ประวัติ และสิทธิ์เข้าใช้
7. เก็บวันเวลา ขนาด backup ระยะเวลากู้ ผลตรวจ และผู้ตรวจในบันทึกการซ้อม; ซ้อมอย่างน้อยเดือนละครั้ง
8. การสลับระบบจริงต้องหยุดขาย ซิงก์ทุกเครื่อง และตกลงช่วงข้อมูลให้ครบก่อนเปลี่ยน connection

Neon retention/PITR ต้องตรวจจาก project จริงแยกต่างหาก เอกสารนี้ไม่ได้ยืนยันว่ามี scheduled backup หรือการแจ้งเตือนบน production แล้ว
สำเนาตั้งค่าระบบ เช่น secrets, domain และ printer configuration ต้องจัดเก็บผ่าน secret manager/คู่มือแยก เพราะไม่ได้อยู่ใน PostgreSQL ทั้งหมด
