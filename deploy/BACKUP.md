# ตั้ง backup รายวันไป Cloudflare R2 (S6-15)

คู่มือนี้ทำตาม `SPEC.md` D-40 และ D-58 ระบบจะ backup ฐานข้อมูลทุกวันเวลา 03:30 น. (เวลาไทย) ขั้นตอนแต่ละรอบเป็นแบบนี้:

1. restic เข้ารหัส backup บน VPS ก่อนส่งขึ้น R2 ทำให้ Cloudflare อ่านข้อมูลไม่ได้
2. ลบ backup ที่เก่ากว่า 35 วันออก
3. ตรวจว่าที่เก็บ backup ไม่เสีย
4. แจ้งผลไปที่ Healthchecks

PO เป็นคนรันเองทีละขั้น ส่วนวิธีอ่านคำสั่ง (`mac$` และ `vps#`) ใช้แบบเดียวกับ `deploy/SETUP.md`
ไม่ต้องพิมพ์ `mac$` หรือ `vps#` เอง ให้พิมพ์เฉพาะส่วนที่ตามหลัง

ทำครั้งแรกบนเครื่อง D-56 เมื่อ 2026-11-03 ผ่านครบทุกขั้น ส่วน "ผลจริง" ที่อยู่ท้ายแต่ละขั้นคือผลที่ได้ในวันนั้น

| ขั้น | ทำที่ไหน | ทำอะไร |
|---|---|---|
| 0 | เว็บ Cloudflare | เปิดใช้ R2, สร้าง bucket และ token |
| 1 | Mac และ VPS | อัปเดตโค้ด |
| 2 | VPS | ติดตั้ง restic |
| 3 | VPS | สร้างรหัสผ่าน restic |
| 4 | VPS | ใส่ R2 keys ลงใน `/etc/stark/backup.env` |
| 5 | เว็บ Healthchecks | สร้าง check "Stark backup" |
| 6 | VPS | `restic init` (ทำครั้งเดียว) |
| 7 | VPS | ติดตั้ง service และ backup ครั้งแรก |
| 8 | VPS | ทดลองกู้คืน |
| 9 | VPS | เปิดให้ backup ทุกวัน |

**ค่าลับในคู่มือนี้** ได้แก่ R2 keys, รหัสผ่าน restic และ URL ของ check:
- ห้ามวางลงแชท, issue หรือ commit (`CLAUDE.md` §5)
- เก็บไว้เพียง 2 ที่: ไฟล์บน VPS ตามขั้น 3–4 และ password manager ของ PO

---

## 0. เตรียมฝั่ง Cloudflare (ทำบนเว็บ)

**0.1 เปิดใช้ R2**
1. เข้า https://dash.cloudflare.com (สมัครบัญชีก่อน ถ้ายังไม่มี)
2. ไปที่ **Storage & databases** → **R2** → **Overview**
3. กด **Add R2 subscription to my account** ระบบจะขอให้ผูกบัตรไว้ด้วย
   - ค่าใช้จ่ายรายเดือนคือ $0 ส่วนที่ใช้ฟรีได้คือ 10 GB, Class A 1 ล้านครั้ง และ Class B 10 ล้านครั้งต่อเดือน
   - ถ้าใช้เกินส่วนฟรี จะตัดเงินจากบัตรที่ผูกไว้

**0.2 สร้าง bucket**

| ช่อง | ค่า |
|---|---|
| Bucket name | `stark-backup` (ตัวพิมพ์เล็กเท่านั้น `Stark` ใช้ไม่ได้) |
| Location | Automatic (ระบบเลือก Asia Pacific ให้) |
| Jurisdiction | ไม่ต้องเลือก |
| Default Storage Class | **Standard** (ส่วนฟรีใช้ได้กับ Standard เท่านั้น ถ้าเลือก Infrequent Access จะเสียเงินตั้งแต่ไบต์แรก) |

**0.3 สร้าง R2 API token**
1. ที่หน้า **R2 Overview** หากล่อง **Account Details** แล้วกด **Manage** ที่อยู่ข้าง **API Tokens**
   - ⚠️ ต้องเข้าจากหน้า R2 เท่านั้น ถ้าไปเปิดหน้า "Account API tokens" ทั่วไป (หน้าที่มี "Permission policies"
     ให้เลือกกว่า 20 แบบ) จะได้ token ที่ใช้กับ restic ไม่ได้ และหน้านั้นมีตัวเลือกที่ให้สิทธิ์กว้างเกินไป
2. กด **Create Account API token** แล้วตั้งค่าตามนี้:
   - **Token name:** `stark-backup-vps`
   - **Permissions:** **Object Read & Write** (หน้าที่ถูกต้องจะมีให้เลือกแค่ 4 แบบ)
   - **Bucket:** เลือกเฉพาะ `stark-backup`
   - **TTL:** Forever
3. หน้าถัดไปจะแสดง **Access Key ID** และ **Secret Access Key** **เพียงครั้งเดียว** ให้คัดลอกไปเก็บใน password manager ทันที
   - ถ้าลืมเก็บ ให้ลบ token แล้วสร้างใหม่

**0.4 Account ID** คือเลขยาว 32 ตัวที่อยู่ใน URL ของ dashboard เช่น
`https://dash.cloudflare.com/<ACCOUNT_ID>/r2/...` เลขนี้ไม่ใช่ความลับ

---

## 1. อัปเดตโค้ดบน VPS

ทำเหมือน `deploy/SETUP.md` ข้อ 7 ต้องใช้โค้ดจาก `main` ที่มี `src/backup/` แล้ว

```
mac$ git pull
mac$ rsync -a --delete --exclude .git --exclude node_modules --exclude dist --exclude .env ./ root@<IP>:/opt/stark/
vps# cd /opt/stark && npm ci && npm run build && npm prune --omit=dev && chown -R root:root /opt/stark
vps# ls -l /opt/stark/dist/backup/main.js
```

- IP ของเครื่อง D-56 คือ `143.14.11.53` ถ้าลืม ให้ดูในอีเมลของ VisperHost หรือรัน `grep 143.14 ~/.ssh/known_hosts` บน Mac
- `npm ci` จะเตือน "11 moderate severity vulnerabilities" ทั้งหมดอยู่ในเครื่องมือ lint ที่ใช้ตอนพัฒนา หลัง `npm prune`
  ผลจะเป็น `found 0 vulnerabilities` **ห้ามรัน `npm audit fix --force`** เพราะจะถอย eslint กลับไปเวอร์ชัน 4

ผลจริง: `-rw-r--r-- 1 root root 1379 ... /opt/stark/dist/backup/main.js`

## 2. ติดตั้ง restic

```
vps# apt-get install -y restic
vps# restic version
```

ผลจริง: `restic 0.16.4` ในรุ่นนี้ log จะไม่มีค่า `bytesAddedPacked` เพราะเพิ่งมีใน restic 0.17 แต่ไม่กระทบการทำงาน

ถ้า apt แจ้ง **"Pending kernel upgrade"** หรือ VPS ขึ้นข้อความ **"System restart required"** ให้ reboot ตอนที่ Stark ยังไม่ได้ทำงาน:

```
vps# reboot
mac$ ssh root@<IP>
vps# uname -r
```

รอประมาณ 1–2 นาทีก่อน SSH เข้าใหม่ ถ้ารอเกิน 5 นาทีแล้วยังเข้าไม่ได้ ให้เปิด console บนหน้าเว็บ VisperHost
ข้อความ "New release '26.04' available" ไม่ต้องทำตาม ให้อยู่ที่ 24.04 LTS ต่อไป
ผลจริง: หลัง reboot `uname -r` ได้ `6.8.0-147-generic`

## 3. รหัสผ่านของ restic

```
vps# (umask 077; openssl rand -base64 32 > /etc/stark/restic-password)
vps# cat /etc/stark/restic-password
```

คัดลอกรหัสที่แสดงไปเก็บใน password manager **ทันที** ถ้า VPS พังและไม่มีรหัสนี้ จะเปิด backup ไม่ได้เลย
ห้ามสร้างรหัสใหม่หลังจากขั้น 6 แล้ว เพราะ backup ที่มีอยู่จะใช้รหัสใหม่เปิดไม่ได้

```
vps# ls -l /etc/stark/restic-password
```

ผลจริง: `-rw------- 1 root root 45 ...` (รหัส 44 ตัวรวมขึ้นบรรทัดใหม่)

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

เวลาตรวจไฟล์นี้ ให้ดูแค่ชื่อตัวแปร ห้าม `cat` แล้วส่งผลให้ใคร:

```
vps# cut -d= -f1 /etc/stark/backup.env
```

ผลจริง: ชื่อตัวแปรครบ 6 ชื่อ คือ `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` และ `BACKUP_HEARTBEAT_URL`

## 5. Check ที่สองใน Healthchecks: "Stark backup"

ทำบนเว็บ Healthchecks:

1. กด **Add Check** แล้วตั้งชื่อว่า `Stark backup`
2. ในกล่อง **Schedule** กด **Change Schedule…** เลือก **Simple** แล้วตั้งค่า:
   - **Period:** `1 day`
   - **Grace Time:** `2 hours`
3. ดูในกล่อง **Notification Methods** ว่าเปิด Telegram และอีเมลไว้ทั้งคู่
4. คัดลอก URL จากกล่อง **How To Ping** ของ check **"Stark backup"** ไปใส่เป็น `BACKUP_HEARTBEAT_URL` ในขั้น 4
   - ระวังอย่าไปคัดลอกจาก check "Stark" ตัวเดิม
   - check ใหม่จะอยู่ในสถานะ **New** และยังไม่แจ้งเตือนอะไร จนกว่าจะได้รับ ping ครั้งแรกในขั้น 7

ถ้าวันไหน backup ไม่สำเร็จ ระบบจะส่ง `/fail` ไปที่ check นี้ทันที คุณจะได้ข้อความแจ้งเตือนเลย
ถ้าวันไหนไม่ได้ backup เลย ข้อความแจ้งเตือนจะมาหลังเลยกำหนด 2 ชั่วโมง

## 6. เตรียมที่เก็บใน R2 (ทำครั้งเดียว)

```
vps# (set -a; . /etc/stark/backup.env; restic init)
```

ต้องขึ้นข้อความ `created restic repository ... at s3:https://...` ถ้าขึ้นว่า repository มีอยู่แล้ว ให้หยุดตรงนั้นแล้วบอก Claude
ห้ามลบ bucket แล้วสร้างใหม่เอง

ถ้าขึ้น `Access Denied` หรือ `SignatureDoesNotMatch` ส่วนใหญ่ key ใส่ผิด เช่นมีช่องว่างเกิน หรือยังมี `< >` ค้างอยู่

ผลจริง: `created restic repository 856890517f at s3:https://<ACCOUNT_ID>.r2.cloudflarestorage.com/stark-backup`

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

`status` อาจขึ้นว่า `inactive (dead)` ซึ่งเป็นเรื่องปกติของงานที่รันครั้งเดียวแล้วจบ ให้ดูบรรทัด `Deactivated successfully` ใน journal แทน

ผลจริง: `backup.completed` snapshot `f0d8fccc`, `bytesProcessed` 707, `pruned` และ `checked` เป็น true, ใช้เวลา 12 วินาที

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

บรรทัด `set_config` ตามด้วย `(1 row)` เป็นคำสั่งตั้งค่าที่ pg_dump ใส่ไว้ต้นไฟล์ทุกครั้ง ไม่ใช่ error

ผลจริง: `1 snapshots`, `Restored 4 files/dirs (707 B)`, `Did not find any relations`

ถ้า Stark ยังไม่เคยเริ่มทำงาน ฐานข้อมูลจะยังไม่มีตาราง เพราะตารางถูกสร้างตอน Stark เริ่มทำงานครั้งแรก ในกรณีนั้น `\dt` จะขึ้นว่า
`Did not find any relations` ซึ่งถือว่าถูกต้อง ให้ทดลองกู้คืนซ้ำอีกครั้งหลังเปิด Stark

## 9. เปิดให้ทำทุกวัน

```
vps# systemctl enable --now stark-backup.timer
vps# systemctl list-timers stark-backup.timer --no-pager
```

ต้องเห็นรอบถัดไป (NEXT) เป็นเวลา 03:30 น. ของวันถัดไปตามเวลาไทย ซึ่งจะแสดงเป็น 20:30 UTC ถ้าเครื่องตั้งเวลาไว้เป็น UTC

ผลจริง: `Wed 2026-11-04 03:30:00 +07`

## ดูแลหลังติดตั้ง

- **ดูผล backup ล่าสุด:** `journalctl -u stark-backup -n 20 --no-pager -o cat`
- **ดูรายการ backup ใน R2:** `(set -a; . /etc/stark/backup.env; restic snapshots --tag stark-db)`
- **backup เองนอกเวลา:** `systemctl start stark-backup.service`
- **ถ้า backup ไม่สำเร็จ:** ข้อความจาก Healthchecks check "Stark backup" จะมาทาง Telegram และอีเมล ให้ส่งผล
  `journalctl` ข้างบนให้ Claude
- **ทดลองกู้คืนซ้ำ:** ทำตามขั้น 8 ควรทำอีกครั้งหลังเปิด Stark เพื่อทดสอบกับข้อมูลจริง

---

## ถ้า VPS พังทั้งเครื่อง: กู้ข้อมูลคืนบนเครื่องใหม่

1. ตั้งเครื่องใหม่ตาม `deploy/SETUP.md`
2. ทำขั้น 2 และขั้น 4 ของคู่มือนี้ โดยใช้รหัสผ่าน restic และ R2 keys จาก password manager แทนการสร้างใหม่
   - ต้องสร้างไฟล์ `/etc/stark/restic-password` จากรหัสเดิมด้วยมือ ห้ามรันขั้น 3 เพราะจะได้รหัสใหม่ที่เปิด backup เดิมไม่ได้
3. รันคำสั่ง `restic restore` ตามขั้น 8 แล้วโหลดไฟล์เข้าฐานข้อมูล `stark` ที่ยังว่างอยู่ แทนฐานข้อมูลทดลอง
