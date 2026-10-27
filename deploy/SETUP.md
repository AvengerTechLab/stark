# ตั้งเครื่อง Stark (S6-14)

คู่มือนี้ใช้กับเครื่องที่ PO เลือกใน `SPEC.md` D-56 (VisperHost "Cloud VPS 02", Ubuntu 24.04 LTS) ซึ่งผ่าน
`scripts/hosting-check.mjs` ครบ 5 ข้อแล้ว (`ARCHITECTURE.md` §8) PO เป็นคนรันเองทีละขั้น

- คำสั่งที่ขึ้นต้นด้วย `mac$` ให้รันบนเครื่องของคุณ ส่วนคำสั่งที่ขึ้นต้นด้วย `vps#` ให้รันบน VPS ในฐานะ root
  ไม่ต้องพิมพ์ `mac$` หรือ `vps#` เอง ให้พิมพ์เฉพาะส่วนที่ตามหลัง
- `<IP>` คือ IP ของเครื่อง VPS ดูได้จากอีเมลของผู้ให้บริการ
- ห้ามวางรหัสผ่าน token หรือไฟล์ `stark.env` ลงในแชท, issue หรือ commit (`CLAUDE.md` §5)

**ขอบเขต:** คู่มือนี้ตั้งเครื่องและวางโค้ดไว้เท่านั้น **ยังไม่เปิด Stark กับช่องทางจริง** เพราะต้องรอให้ gate A-1
ผ่าน Stop Gate ก่อน (`TASKS.md`, Next Phases)

---

## 1. ล็อกอินด้วย SSH key แทนรหัสผ่าน (T-12)

สร้าง key บนเครื่องของคุณ (ถ้ามี `~/.ssh/id_ed25519` อยู่แล้วให้ข้ามบรรทัดแรก) แล้วส่ง key ขึ้น VPS:

```
mac$ ssh-keygen -t ed25519
mac$ ssh-copy-id root@<IP>
mac$ ssh root@<IP>
```

ถ้าบรรทัดสุดท้ายเข้าเครื่องได้**โดยไม่ถามรหัสผ่าน** แปลว่า key ใช้ได้ จากนั้นปิดการล็อกอินด้วยรหัสผ่าน:

```
vps# cat > /etc/ssh/sshd_config.d/00-stark.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
vps# sshd -t && systemctl restart ssh
```

ไฟล์ชื่อขึ้นต้นด้วย `00-` เพื่อให้ถูกอ่านก่อนไฟล์ที่ระบบสร้างไว้ เช่น `50-cloud-init.conf` (OpenSSH ใช้ค่าแรกที่เจอ)

**ห้ามปิดหน้าต่างเดิม** จนกว่าจะเปิดหน้าต่างใหม่แล้ว `mac$ ssh root@<IP>` เข้าได้ ถ้าเข้าไม่ได้ ให้ลบไฟล์
`00-stark.conf` จากหน้าต่างเดิม แล้ว `systemctl restart ssh` อีกครั้ง

ตรวจว่าการตั้งค่ามีผลจริง ต้องได้ `passwordauthentication no`:

```
vps# sshd -T | grep -E 'passwordauthentication|permitrootlogin'
```

## 2. อัปเดตระบบ และให้อัปเดตความปลอดภัยเอง

```
vps# apt-get update && apt-get -y upgrade
vps# apt-get install -y unattended-upgrades
vps# dpkg-reconfigure -plow unattended-upgrades
vps# [ -f /var/run/reboot-required ] && reboot
```

ตอน `dpkg-reconfigure` ให้ตอบ **Yes** ส่วนข้อความ "New release '26.04' available" ไม่ต้องทำตาม ให้อยู่ที่ 24.04 LTS

ระหว่าง `apt-get -y upgrade` อาจมีหน้าจอถามขึ้นมา (พบบนเครื่อง D-56 เมื่อ 2026-10-19):

- **Configuring console-setup** (ฟอนต์ของ console): กด Enter รับค่าที่เลือกไว้ ไม่มีผลกับ Stark
- **Configuring grub-pc** (ตัวบูตเครื่อง): กด Space ให้ดิสก์ทั้งลูกเป็น `[*]` แล้ว Tab ไป `<Ok>` บนเครื่อง D-56 คือ
  `/dev/sda` เครื่องอื่นอาจเป็น `/dev/vda` อย่าเลือกพาร์ทิชันที่มีเลขต่อท้าย เช่น `/dev/sda1`
  ถ้าเลือกผิด เครื่องอาจบูตไม่ขึ้นหลัง reboot
- ข้อความ "Service restarts being deferred" หรือ "outdated binaries" เป็นเรื่องปกติ หายไปหลัง reboot

## 3. Firewall: เปิดแค่ SSH (D-38)

VisperHost ไม่ได้ติดตั้ง `ufw` มาให้ ให้ติดตั้งจาก apt ก่อน (ไม่ใช้ snap):

```
vps# apt-get install -y ufw
vps# ufw default deny incoming
vps# ufw default allow outgoing
vps# ufw allow OpenSSH
vps# ufw enable
vps# ufw status verbose
```

ผลต้องมีแค่ `22/tcp ALLOW IN` หน้าเว็บของ Stark ไม่ต้องเปิดพอร์ต เพราะเข้าผ่าน SSH tunnel (D-53)

## 4. เวลาของเครื่อง (T-14)

```
vps# timedatectl
```

ต้องเห็น `System clock synchronized: yes` และ `NTP service: active` ถ้าไม่ใช่ ให้รัน `vps# timedatectl set-ntp true`

## 5. PostgreSQL 16 รับเฉพาะในเครื่อง (D-22, D-25)

Ubuntu 24.04 ติดตั้ง PostgreSQL 16 ให้จากแพ็กเกจ `postgresql`:

```
vps# apt-get install -y postgresql
vps# ss -tlnp | grep 5432
```

ทุกบรรทัดต้องเป็น `127.0.0.1:5432` หรือ `[::1]:5432` เท่านั้น ห้ามมี `0.0.0.0` หรือ `*`

สร้างผู้ใช้และฐานข้อมูลของ Stark (ระบบจะถามรหัสผ่าน ให้ตั้งใหม่ยาว ๆ แล้วจดเก็บไว้ในที่ปลอดภัย):

```
vps# sudo -u postgres createuser --pwprompt stark
vps# sudo -u postgres createdb --owner stark stark
```

Stark สร้างตารางเองตอนเริ่มทำงาน (`src/index.ts` เรียก `migrate`)

## 6. ผู้ใช้ `stark` และโฟลเดอร์

```
vps# useradd --system --no-create-home --shell /usr/sbin/nologin stark
vps# mkdir -p /opt/stark /etc/stark
vps# chmod 700 /etc/stark
```

## 7. วางโค้ดและ build

จากโฟลเดอร์ repo stark บนเครื่องของคุณ ที่อยู่บน `main` ล่าสุด:

```
mac$ git pull
mac$ rsync -a --delete --exclude .git --exclude node_modules --exclude dist --exclude .env ./ root@<IP>:/opt/stark/
```

บน VPS: ต้อง build ก่อนตัด dev dependency ออก เพราะ TypeScript เป็น dev dependency

```
vps# cd /opt/stark
vps# npm ci
vps# npm run build
vps# npm prune --omit=dev
vps# chown -R root:root /opt/stark
```

ผู้ใช้ `stark` แค่อ่านโค้ด ไม่ต้องเขียน (`deploy/stark.service` ตั้ง `ProtectSystem=strict` ไว้)

## 8. ติดตั้ง service แต่ยังไม่เปิด

```
vps# cp /opt/stark/deploy/stark.service /etc/systemd/system/stark.service
vps# systemctl daemon-reload
```

**หยุดที่ขั้นนี้** ยังไม่ต้องสร้าง `/etc/stark/stark.env` ที่มี token จริง และยังไม่ต้อง `systemctl enable --now stark`
จนกว่า gate A-1 จะผ่าน

## 9. ตัวเฝ้าระบบภายนอก: Healthchecks.io (D-57)

ตัวนี้บอก PO เมื่อ Stark หรือเครื่องทั้งเครื่องหยุด (`SECURITY.md` T-17) ทำบนเว็บ ยกเว้นข้อ 5

1. สมัครที่ https://healthchecks.io ด้วยอีเมลที่เช็กเป็นประจำ แล้วเลือกแผน Hobbyist (ฟรี) ระบบสร้าง check ชื่อ
   "My First Check" และผูกอีเมลนั้นไว้ให้
2. เปิด check นั้น เปลี่ยนชื่อเป็น `Stark` ในกล่อง **Schedule** กด **Change Schedule…** เลือก **Simple**
   ตั้ง **Period** `5 minutes` และ **Grace Time** `10 minutes` แล้ว Save (เงียบเกิน 15 นาทีจึงแจ้ง)
3. เมนู **Integrations** → **Telegram** → **Add Integration** กดชื่อบอทของ Healthchecks (ไม่ใช่บอทของ Stark)
   พิมพ์ `/start` กดลิงก์ที่บอทตอบ แล้วกด **Connect Telegram**
4. หน้า **Integrations** กด **Test!** ที่แถว Email และแถว Telegram ต้องได้ข้อความทั้งสองทาง
5. ทดสอบจาก VPS: คัดลอก URL ในกล่อง **How To Ping** (ขึ้นต้นด้วย `https://hc-ping.com/`) แล้วพิมพ์
   `curl -fsS -m 10 ` ตามด้วย URL นั้น โดยเว้นวรรค 1 ช่องหน้า `curl` เพื่อไม่ให้ URL อยู่ในประวัติคำสั่ง

   ```
   vps#  curl -fsS -m 10 https://hc-ping.com/<รหัสของ check>
   ```

   ต้องขึ้น `OK` และหน้า check ต้องขึ้นว่าได้รับ "HTTPS GET from" IP ของ VPS ถ้า timeout ให้ลอง
   `curl -4 -sS -m 10 -o /dev/null -w '%{http_code}\n' https://hc-ping.com/` ถ้าได้ `000` แปลว่าเครื่องออกไปหา
   Healthchecks ไม่ได้ (บนเครื่อง D-56 เคยเป็น เพราะเส้นทางไป Hetzner ถูกกั้น VisperHost แก้ให้แล้ว)
6. ประมาณ 15 นาทีหลังข้อ 5 check ต้องเป็น **Down** และ PO ต้องได้ข้อความทั้งทาง Telegram และอีเมล
   ข้อนี้ยังไม่ผ่านบนเครื่อง D-56 (`TASKS.md` Discovered Work)
7. หลังข้อ 6 ผ่าน กด **Pause** ที่หน้า check ให้เงียบไว้จนกว่าจะเปิด Stark ping แรกจาก Stark จะเปิดการเฝ้าเอง

URL ของ check เป็นความลับ (ใครมีก็ส่ง ping ปลอมได้) ห้ามวางลงแชท, issue หรือ commit ใส่ไว้ที่เดียวคือ
`HEARTBEAT_URL` ใน `/etc/stark/stark.env` ตอนสร้างไฟล์นั้นหลัง gate A-1

---

## ส่งผลกลับมา

ส่งผลของ 4 คำสั่งนี้มาให้ Claude (ไม่มีข้อมูลลับในผลเหล่านี้):

```
vps# sshd -T | grep -E 'passwordauthentication|permitrootlogin'
vps# ufw status verbose
vps# timedatectl
vps# ss -tlnp | grep 5432
```

## ยังรอ PO ตัดสิน (ก่อนเปิดใช้จริง)

- ~~ตัวเฝ้าระบบภายนอก~~ เลือกแล้ว: Healthchecks.io (D-57) ตั้งตามข้อ 9
- **ที่เก็บ backup นอกเครื่อง** สำหรับ backup รายวันแบบเข้ารหัส เก็บ 35 วัน (D-40) backup ทุก 3 วันของ VisperHost
  ใช้แทนไม่ได้
