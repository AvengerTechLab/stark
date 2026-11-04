# เพิ่มช่องทางแจ้งเตือน: Discord, LINE, อีเมล (D-09, D-62)

โค้ดของทั้ง 4 ช่องทางมีอยู่แล้ว ตอนนี้ Stark ใช้แค่ Telegram ช่องทางอื่นจะเริ่มทำงานเมื่อใส่ค่าของช่องทางนั้นใน
`/etc/stark/stark.env` แล้ว restart Stark ทำทีละช่องทาง และทดสอบให้ผ่านก่อนขึ้นช่องทางถัดไป

- คำสั่งที่ขึ้นต้นด้วย `vps#` ให้รันบน VPS ในฐานะ root
- **ค่าทุกค่าในคู่มือนี้เป็นความลับ** ห้ามวางในแชท, issue หรือ commit (`CLAUDE.md` §5) ให้เก็บไว้ในตัวจัดการรหัสผ่าน
  และใน `stark.env` เท่านั้น
- กฎที่สร้างผ่าน Telegram จะส่งไปทุกช่องทางที่ตั้งค่าแล้วและเปิดอยู่ ส่วนกฎเก่าจะส่งเฉพาะช่องทางที่เลือกไว้ตอนสร้างกฎ
  ถ้าจะให้กฎเก่าส่งไปช่องทางใหม่ด้วย ให้ลบกฎนั้นแล้วสร้างใหม่ (หน้าเว็บยังไม่มีปุ่มแก้ช่องทางของกฎ)

ลำดับที่แนะนำคือ Discord, LINE แล้วจึงอีเมล

---

## Discord

ใช้ webhook ของห้องหนึ่งห้องใน server ของคุณ ได้ค่ามาค่าเดียวคือ `DISCORD_WEBHOOK_URL` ใครได้ URL นี้ไปก็ส่งข้อความเข้าห้องนั้นได้
(`SECURITY.md` T-19)

### D-1. สร้าง webhook (ทำในแอป Discord)

1. ถ้ายังไม่มี server ของตัวเอง: กด **+** ทางซ้ายสุด → **Create My Own** → **For me and my friends** → ตั้งชื่อ เช่น `Stark`
2. คลิกขวาที่ชื่อ server → **Server Settings** → **Integrations** → **Webhooks** → **New Webhook**
3. เลือกห้องที่จะรับ alert แล้วกด **Copy Webhook URL** URL ขึ้นต้นด้วย `https://discord.com/api/webhooks/`
4. เก็บ URL ไว้ในตัวจัดการรหัสผ่าน

### D-2. ใส่ใน `stark.env`

```
vps# nano /etc/stark/stark.env
```

เพิ่มบรรทัดนี้ไว้ท้ายไฟล์ แล้ววาง URL ของคุณแทน `<URL>` ไม่ต้องมีเครื่องหมายคำพูด ไม่ต้องมีวงเล็บ `< >`
และไม่ต้องเติมอะไรต่อท้าย

```
DISCORD_WEBHOOK_URL=<URL>
```

บันทึกด้วย `Ctrl+O` แล้วกด `Enter` จากนั้นออกด้วย `Ctrl+X` แล้วตรวจไฟล์โดยไม่ให้แสดงค่า:

```
vps# cut -d= -f1 /etc/stark/stark.env
vps# grep -c '^DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/' /etc/stark/stark.env
```

คำสั่งแรกต้องมี `DISCORD_WEBHOOK_URL` อยู่ในรายชื่อ คำสั่งที่สองต้องได้ `1`

### D-3. Restart และตรวจ

```
vps# systemctl restart stark
vps# journalctl -u stark -n 30 --no-pager | grep app.started
```

ใน `channelsConfigured` ต้องมี `"discord"` เพิ่มเข้ามาต่อจาก `"telegram"`

ถ้าไม่มีบรรทัด `app.started` ให้ดู error ด้วยคำสั่งนี้ แล้วส่งผลมาให้ Claude (Stark ซ่อนค่าลับใน log ให้แล้ว):

```
vps# journalctl -u stark -n 30 --no-pager
```

### D-4. ทดสอบด้วย alert จริงหนึ่งครั้ง

1. ส่งคำสั่งนี้ใน Telegram ถึงบอท ราคานี้สูงมาก กฎจึงทำงานทันที:
   `/below BTC/THB 999999999`
2. ข้อความ "เพิ่มกฎแล้ว …" จากบอทต้องมี `discord` อยู่ในวงเล็บ
3. ภายในไม่กี่วินาที alert ต้องมาถึงทั้ง Telegram และห้องใน Discord
4. ลบกฎทดสอบทิ้ง: `/delete <ID ที่บอทตอบ>` แล้วตอบยืนยันตามที่บอทถาม

ถ้า Discord ตอบว่า webhook นี้ไม่มีแล้ว (`404`) Stark จะหยุดใช้ช่องทางนี้และแจ้งทาง Telegram ให้สร้าง webhook ใหม่
(ข้อ D-1) แล้วใส่แทนของเดิม (ข้อ D-2 และ D-3)

---

## LINE

ยังไม่ได้เขียน จะเขียนเมื่อ Discord ผ่านแล้ว ต้องใช้ 2 ค่า: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_OWNER_USER_ID`

## อีเมล (Gmail)

ยังไม่ได้เขียน ต้องใช้ 5 ค่า: `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN`,
`GMAIL_SENDER`, `ALERT_EMAIL_TO` (D-28, D-41, D-50, D-54)

---

## ผลที่ทำจริง

| ช่องทาง | วันที่ | ผล |
|---|---|---|
| Discord | — | ยังไม่ได้ทำ |
| LINE | — | ยังไม่ได้ทำ |
| อีเมล | — | ยังไม่ได้ทำ |
