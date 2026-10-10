# หมวดวัตถุดิบ

หมวดหลัก: `FOOD` วัตถุดิบอาหาร, `SEASONING` เครื่องปรุง,
`PACKAGING` บรรจุภัณฑ์และวัสดุสิ้นเปลือง

Migration เพิ่ม enum และคอลัมน์ nullable ใน ingredients เท่านั้น ไม่ backfill
หรือเดาหมวดจากชื่อ รายการเดิมแสดง “ยังไม่ระบุหมวด” และเลือกจัดหมวดได้ภายหลัง
ไม่มีการแก้ยอดสต็อก ต้นทุน สูตร บิล หรือประวัติการเคลื่อนไหว

API รับ category เฉพาะสามค่า หรือ null การส่ง payload เดิมที่ไม่มี category
ยังใช้งานได้และไม่เปลี่ยนหมวดที่บันทึกไว้ ผู้ใช้ OWNER เท่านั้นแก้ไขได้
การบันทึกใช้ transaction และ audit log เดิม

เพิ่ม/แก้ไขใน สูตรและต้นทุน > วัตถุดิบ และกรองสต็อกคงเหลือใน สต็อก > ภาพรวม
ตัวกรองใช้เฉพาะการแสดงผล ไม่เปลี่ยนรายการรับของ นับสต็อก หรือใบสั่งซื้อ

ก่อน Production: ทดสอบ migrate deploy บน branch สำเนา production,
ตรวจ fingerprints ทุกตาราง, สร้าง Neon snapshot และทดลอง restore ไป branch ใหม่
หรือสร้าง branch สำรองเต็มจาก Production และตรวจ fingerprints ของสำเนา
หากถึงโควตา snapshot เก็บ branch สำรองไว้และไม่ใช้ branch นี้สำหรับทดสอบ
จากนั้น migrate deploy ผ่าน direct connection และตรวจข้อมูลก่อน–หลังอีกครั้ง
หาก migration ติด lock timeout ให้ตรวจสถานะก่อน retry ห้าม reset/drop ฐาน production
หากต้องย้อนหน้าเว็บ ให้ใช้ deployment เดิมได้ คอลัมน์ nullable ใช้ร่วมกับโค้ดเดิมได้
การกู้ snapshot ต้องตรวจธุรกรรมใหม่หลัง backup และเลือกกู้รายส่วนเมื่อจำเป็น
ห้าม restore ทับ production โดยอัตโนมัติ
