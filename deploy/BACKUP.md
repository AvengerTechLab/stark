# ตั้ง backup รายวันไป Cloudflare R2 (S6-15)

คู่มือนี้ทำตาม `SPEC.md` D-40 และ D-58 ระบบจะ backup ฐานข้อมูลทุกวันเวลา 03:30 น. (เวลาไทย) ขั้นตอนแต่ละรอบเป็นแบบนี้:

1. restic เข้ารหัส backup บน VPS ก่อนส่งขึ้น R2 ทำให้ Cloudflare อ่านข้อมูลไม่ได้
2. ลบ backup ที่เก่ากว่า 35 วันออก
3. ตรวจว่าที่เก็บ backup ไม่เสีย
4. แจ้งผลไปที่ Healthchecks

PO เป็นคนรันเองทีละขั้น ส่วนวิธีอ่านคำสั่ง (`mac$` และ `vps#`) ใช้แบบเดียวกับ `deploy/SETUP.md`

**ค่าลับในคู่มือนี้** ได้แก่ R2 keys, รหัสผ่าน restic และ URL ของ check:
- ห้ามวางลงแชท, issue หรือ commit (`CLAUDE.md` §5)
- เก็บไว้เพียง 2 ที่: ไฟล์บน VPS ตามขั้น 3–4 และ password manager ของ PO

**ต้องมีก่อนเริ่ม:**
- bucket `stark-backup`
- R2 API token แบบ Object Read & Write ที่ใช้ได้เฉพาะ bucket นี้ ต้องมีทั้ง Access Key ID และ Secret Access Key
- Account ID ของ Cloudflare (เลขยาวที่อยู่ใน URL ของ dashboard)

---

## 1. อัปเดตโค้ดบน VPS

ทำเหมือน `deploy/SETUP.md` ข้อ 7 ต้องใช้โค้ดจาก `main` ที่มี `src/backup/` แล้ว

```
mac$ git pull
mac$ rsync -a --delete --exclude .git --exclude node_modules --exclude dist --exclude .env ./ root@<IP>:/opt/stark/
vps# cd /opt/stark && npm ci && npm run build && npm prune --omit=dev && chown -R root:root /opt/stark
vps# ls -l /opt/stark/dist/backup/main.js
```

## 2. ติดตั้ง restic

```
vps# apt-get install -y restic
vps# restic version
```

## 3. รหัสผ่านของ restic

```
vps# (umask 077; openssl rand -base64 32 > /etc/stark/restic-password)
vps# cat /etc/stark/restic-password
```

คัดลอกรหัสที่แสดงไปเก็บใน password manager **ทันที** ถ้า VPS พังและไม่มีรหัสนี้ จะเปิด backup ไม่ได้เลย
ห้ามสร้างรหัสใหม่หลังจากขั้น 6 แล้ว เพราะ backup ที่มีอยู่จะใช้รหัสใหม่เปิดไม่ได้

## 4. ไฟล์ค่าลับของ backup

สร้างก่อนเป็นไฟล์ว่างที่อ่านได้เฉพาะ root แล้วจึงค่อยใส่ค่า:

```
vps# install -m 600 -o root -g root /dev/null /etc/stark/backup.env
vps# nano /etc/stark/backup.env
```

ใส่ 6 บรรทัดนี้ แล้วแทนส่วนที่อยู่ใน `< >` ด้วยค่าจริง:

```
RESTIC_REPOSITORY=s3:https://<ACCOUNT_ID>.r2.cloudflarestorage.com/stark-backup
RESTIC_PASSWORD_FILE=/etc/stark/restic-password
AWS_ACCESS_KEY_ID=<Access Key ID>
AWS_SECRET_ACCESS_KEY=<Secret Access Key>
AWS_DEFAULT_REGION=auto
BACKUP_HEARTBEAT_URL=<URL ของ check "Stark backup" จากขั้น 5>
```

- `AWS_DEFAULT_REGION=auto` เป็นค่าที่ Cloudflare กำหนดให้ R2
- ถ้ายังไม่ได้ทำขั้น 5 ให้เว้นบรรทัดสุดท้ายไว้ก่อน แล้วค่อยกลับมาใส่

```
vps# ls -l /etc/stark/backup.env /etc/stark/restic-password
```

ทั้งสองไฟล์ต้องขึ้นเป็น `-rw------- 1 root root`

## 5. Check ที่สองใน Healthchecks: "Stark backup"

ทำบนเว็บ Healthchecks:

1. กด **Add Check** แล้วตั้งชื่อว่า `Stark backup`
2. ในกล่อง **Schedule** กด **Change Schedule…** เลือก **Simple** แล้วตั้งค่า:
   - **Period:** `1 day`
   - **Grace Time:** `2 hours`
3. ดูในกล่อง **Notification Methods** ว่าเปิด Telegram และอีเมลไว้ทั้งคู่
4. คัดลอก URL จากกล่อง **How To Ping** ไปใส่เป็น `BACKUP_HEARTBEAT_URL` ในขั้น 4

ถ้าวันไหน backup ไม่สำเร็จ ระบบจะส่ง `/fail` ไปที่ check นี้ทันที คุณจะได้ข้อความแจ้งเตือนเลย
ถ้าวันไหนไม่ได้ backup เลย ข้อความแจ้งเตือนจะมาหลังเลยกำหนด 2 ชั่วโมง

## 6. เตรียมที่เก็บใน R2 (ทำครั้งเดียว)

```
vps# (set -a; . /etc/stark/backup.env; restic init)
```

ต้องขึ้นข้อความ `created restic repository ... at s3:https://...` ถ้าขึ้นว่า repository มีอยู่แล้ว ให้หยุดตรงนั้นแล้วบอก Claude
ห้ามลบ bucket แล้วสร้างใหม่เอง

## 7. ติดตั้ง service และทดลอง backup ครั้งแรก

```
vps# cp /opt/stark/deploy/stark-backup.service /opt/stark/deploy/stark-backup.timer /etc/systemd/system/
vps# systemctl daemon-reload
vps# systemctl start stark-backup.service
vps# systemctl status stark-backup.service --no-pager | head -5
vps# journalctl -u stark-backup -n 20 --no-pager -o cat
```

ผลที่ควรเห็น:
- `status` ขึ้น `status=0/SUCCESS`
- ใน journal มีบรรทัด `"event":"backup.completed"` ซึ่งบอกขนาดของ backup (`bytesProcessed`, `bytesAddedPacked`)
- ใน Healthchecks check "Stark backup" ขึ้นเป็น **Up**

ส่งผลของ `journalctl` มาให้ Claude ได้ เพราะ logger ซ่อนค่าลับไว้แล้ว

## 8. ทดลองกู้ข้อมูลคืน (พิสูจน์ว่า backup ใช้ได้จริง)

ขั้นนี้กู้ข้อมูลไปไว้ในฐานข้อมูลทดลองที่แยกจากของจริง **ไม่แตะฐานข้อมูล `stark`**

```
vps# (set -a; . /etc/stark/backup.env; restic snapshots --tag stark-db)
vps# (set -a; . /etc/stark/backup.env; restic restore latest --tag stark-db --target /root/stark-restore)
vps# runuser -u postgres -- createdb stark_restore_test
vps# runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 -d stark_restore_test < /root/stark-restore/var/lib/stark-backup/stark.sql
vps# runuser -u postgres -- psql -d stark_restore_test -c '\dt'
vps# runuser -u postgres -- dropdb stark_restore_test
vps# rm -rf /root/stark-restore
```

ส่งผลของ `restic snapshots` และ `\dt` มาให้ Claude ได้

ถ้า Stark ยังไม่เคยเริ่มทำงาน ฐานข้อมูลจะยังไม่มีตาราง เพราะตารางถูกสร้างตอน Stark เริ่มทำงานครั้งแรก ในกรณีนั้น `\dt` จะขึ้นว่า
`Did not find any relations` ซึ่งถือว่าถูกต้อง ให้ทดลองกู้คืนซ้ำอีกครั้งหลังเปิด Stark

## 9. เปิดให้ทำทุกวัน

```
vps# systemctl enable --now stark-backup.timer
vps# systemctl list-timers stark-backup.timer --no-pager
```

ต้องเห็นรอบถัดไป (NEXT) เป็นเวลา 03:30 น. ของวันถัดไปตามเวลาไทย ซึ่งจะแสดงเป็น 20:30 UTC ถ้าเครื่องตั้งเวลาไว้เป็น UTC

---

## ถ้า VPS พังทั้งเครื่อง: กู้ข้อมูลคืนบนเครื่องใหม่

1. ตั้งเครื่องใหม่ตาม `deploy/SETUP.md`
2. ทำขั้น 2 และขั้น 4 ของคู่มือนี้ โดยใช้รหัสผ่าน restic และ R2 keys จาก password manager แทนการสร้างใหม่
   - ต้องสร้างไฟล์ `/etc/stark/restic-password` จากรหัสเดิมด้วยมือ ห้ามรันขั้น 3 เพราะจะได้รหัสใหม่ที่เปิด backup เดิมไม่ได้
3. รันคำสั่ง `restic restore` ตามขั้น 8 แล้วโหลดไฟล์เข้าฐานข้อมูล `stark` ที่ยังว่างอยู่ แทนฐานข้อมูลทดลอง
