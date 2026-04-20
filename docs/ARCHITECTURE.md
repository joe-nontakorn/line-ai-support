# 🤖 System Architecture: Jastel IT Support Line Bot (AI-Powered)

## 📋 Table of Contents
- [Project Overview](#project-overview)
- [System Architecture Diagram](#system-architecture-diagram)
- [Message Flow (Sequence Diagram)](#message-flow-sequence-diagram)
- [Conversation State Machine](#conversation-state-machine)
- [Ticket Lifecycle](#ticket-lifecycle)
- [AI Pipeline (RAG + Policy)](#ai-pipeline-rag--policy)
- [Data Model (ERD)](#data-model-erd)
- [API Endpoints](#api-endpoints)
- [Deployment & Network Topology](#deployment--network-topology)
- [Directory Structure](#directory-structure)
- [Technology Stack](#technology-stack)

---

## 🔍 Project Overview
**Jastel IT Support Line Bot** คือระบบผู้ช่วยอัจฉริยะ (AI Assistant) บนแพลตฟอร์ม LINE ที่ออกแบบมาเพื่อยกระดับงานบริการ IT Support ภายในองค์กร โดยใช้ขุมพลังจาก **Google Gemini AI** ในการวิเคราะห์ปัญหาและให้คำแนะนำเบื้องต้นแก่พนักงานแบบ Self-Service พร้อมระบบเชื่อมต่อฐานข้อมูลอุปกรณ์ (Asset Management) เพื่อตรวจสอบสถานะประกัน และระบบ Ticket Escalation แจ้งเตือนไปยังทีม Admin โดยอัตโนมัติ

---

## 🏗️ System Architecture Diagram

> ข้อมูลอ้างอิงจาก source code จริง: `app.ts`, `handlers/main.ts`, `gemini.ts`, `api.ts`

```mermaid
graph TB
    subgraph USERS["👥 ผู้ใช้งาน"]
        EMP["👤 พนักงาน (LINE App)"]
        ADMIN["🖥️ IT Admin (Web Dashboard)"]
    end

    subgraph GATEWAY["🌐 Platform and Gateway"]
        LINE_API["💬 LINE Messaging API"]
        CF["☁️ Cloudflare Tunnel (Public HTTPS)"]
    end

    subgraph SERVER["🖥️ Application Server — Bun.js + Express port 3002"]
        direction TB
        WEBHOOK["📥 POST /webhook\nHMAC-SHA256 Signature Validation\n→ 200 OK ทันที → Background Process"]
        REST["📡 REST API /api/*"]
        STATIC["📁 /uploads Static Files"]

        subgraph LINESVC["LineService → Event Router"]
            FOLLOW["FollowEvent → handleFollow"]
            MSG_HANDLER["MessageEvent\n→ handleTextMessage\n→ handleMedia / handleSticker"]
        end

        subgraph HANDLERS["Handlers Layer"]
            MAIN_H["main.ts\n• Greeting Keywords\n• Ticket Query (IT-XXXXXX)\n• Device Query via Asset API\n• ยืนยันปิดเคส / ตีกลับ\n• Rating Flow\n• Gemini AI Chat"]
            SUPPORT_H["support.ts\n• escalateToSupport()\n• สร้าง Ticket\n• analyzeIssue / clarifyIssue (AI)\n• Notify Admin Group"]
            REG_H["registration.ts\n• Employee ID / Email verify\n• OTP via Gmail SMTP\n• Create User record"]
            MEDIA_H["media.ts\n• Image → base64 → Gemini Vision\n• PDF → base64 → Gemini Vision"]
        end

        subgraph SERVICES["Core Services"]
            GEMINI_SVC["🧠 GeminiService\nModel: gemini-3.1-flash-lite-preview\nchat() Semaphore max 10\nanalyzeImage/PDF() Semaphore max 5\nRAG: searchRelatedTickets()\nRetry Backoff + 30s Timeout"]
            CONV_SVC["ConversationService\nSession Lifecycle Management\nappendUserMessage()\nappendAssistantMessage()"]
            MSG_SVC["MessagingService\nreplyText()\nreplyTextWithQuickReply()\npushMultipleMessages()\nshowLoadingAnimation()"]
            AUTO_CLOSE["⏰ ticketAutoClose Worker\nCron ทุก 1 ชม.\nAuto-close resolved > 72 ชม."]
        end

        subgraph APIHANDLERS["REST API Handlers"]
            A1["GET /api/stats\n(users, ratings, resolution time, depts)"]
            A2["GET /api/tickets\n(pagination + filter by status)"]
            A3["GET /api/issues\n(Top Issues จาก Conversations)"]
            A4["GET /api/ratings\n(คะแนน 1-5)"]
            A5["GET /api/trends\n(7 วันย้อนหลัง)"]
            A6["GET /api/activity\n(Ticket + StatusHistory Feed)"]
            A7["GET /api/users\n(pagination + search)"]
            A8["GET /api/conversations\n(pagination + filter)"]
            A9["PUT /api/tickets/:id/status\nMulter File Upload 10MB\nUpdate DB + Push LINE Notify"]
        end
    end

    subgraph AI_DB["🗄️ AI and Database"]
        GEMINI["✨ Google Gemini AI\ngemini-3.1-flash-lite-preview\nmaxTokens 800 / temp 0.3 / topP 0.85"]
        MONGO["🍃 MongoDB\ncollections: users / conversations / tickets\nText Index สำหรับ RAG"]
    end

    subgraph INTEGRATIONS["🔗 Integrations"]
        ASSET_API["📦 Asset API Internal\nhttp://172.16.1.16:3000/api\nGET /assets/search?employee_name="]
        GMAIL["📧 Gmail SMTP\nNodemailer OTP Verification"]
        ADMIN_GROUP["👥 Admin LINE Group\nenv ADMIN_GROUP_ID\nNew Ticket Alerts + Bounce Alerts"]
    end

    subgraph FRONTEND["🖥️ IT Admin Dashboard React + Vite"]
        DASH["📊 LineSupportDashboard\nfetch /line-api/stats /tickets\n/issues /ratings /trends /activity"]
        ESC["🚨 EscalatedIssues\nfetch /line-api/tickets\nPUT status + file upload\nPolling ทุก 10 วินาที"]
        USERS_P["👤 Users Page\nfetch /line-api/users"]
        CONV_P["💬 UserConversations\nfetch /line-api/conversations"]
    end

    EMP -->|"ส่งข้อความ / รูป / ไฟล์ / Sticker"| LINE_API
    LINE_API -->|"POST /webhook"| CF
    CF -->|"HTTPS to HTTP tunnel"| WEBHOOK
    WEBHOOK --> LINESVC
    FOLLOW --> REG_H
    MSG_HANDLER --> MAIN_H
    MSG_HANDLER --> SUPPORT_H
    MSG_HANDLER --> MEDIA_H
    MAIN_H --> GEMINI_SVC
    MAIN_H --> CONV_SVC
    SUPPORT_H --> CONV_SVC
    SUPPORT_H --> GEMINI_SVC
    MEDIA_H --> GEMINI_SVC
    REG_H --> GMAIL
    REG_H --> CONV_SVC
    GEMINI_SVC <-->|"generateContent() / startChat()"| GEMINI
    GEMINI_SVC -->|"RAG Text Search resolved tickets"| MONGO
    CONV_SVC <--> MONGO
    MAIN_H <-->|"Ticket.findOne() / ticket.save()"| MONGO
    SUPPORT_H -->|"new Ticket().save()"| MONGO
    AUTO_CLOSE <--> MONGO
    MAIN_H -->|"Device Query /assets/search?employee_name="| ASSET_API
    MSG_SVC -->|"replyMessage() / pushMessage()"| LINE_API
    LINE_API --> EMP
    MSG_SVC -->|"pushMessage(adminGroupId)"| ADMIN_GROUP
    REST --> APIHANDLERS
    A1 <--> MONGO
    A2 <--> MONGO
    A3 <--> MONGO
    A4 <--> MONGO
    A5 <--> MONGO
    A6 <--> MONGO
    A7 <--> MONGO
    A8 <--> MONGO
    A9 <--> MONGO
    A9 -->|"Push Status + Files"| MSG_SVC
    A9 --> STATIC
    ADMIN --> FRONTEND
    DASH -->|"Vite proxy /line-api → port 3002"| REST
    ESC --> REST
    USERS_P --> REST
    CONV_P --> REST

    style USERS fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
    style GATEWAY fill:#fef3c7,stroke:#d97706,color:#78350f
    style SERVER fill:#f0fdf4,stroke:#16a34a,color:#14532d
    style AI_DB fill:#fdf4ff,stroke:#a21caf,color:#581c87
    style INTEGRATIONS fill:#fff7ed,stroke:#ea580c,color:#7c2d12
    style FRONTEND fill:#eff6ff,stroke:#2563eb,color:#1e3a8a
    style LINESVC fill:#dcfce7,stroke:#15803d,color:#14532d
    style HANDLERS fill:#d1fae5,stroke:#059669,color:#065f46
    style SERVICES fill:#bbf7d0,stroke:#16a34a,color:#14532d
    style APIHANDLERS fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
```

---

## 📨 Message Flow (Sequence Diagram)

### กรณีที่ 1: ผู้ใช้ถามปัญหา IT → AI ตอบ

```mermaid
sequenceDiagram
    participant U as 👤 พนักงาน (LINE)
    participant L as LINE Platform
    participant W as Webhook Handler
    participant LS as LineService
    participant CS as ConversationService
    participant GS as GeminiService
    participant G as Google Gemini API
    participant DB as MongoDB

    U->>L: ส่งข้อความ "เน็ตช้ามาก"
    L->>W: POST /webhook (events)
    W->>W: Validate Signature
    W-->>L: 200 OK (ตอบทันที)

    Note over W: ประมวลผล Background

    W->>LS: handleMessage(event)
    LS->>LS: showLoadingAnimation()
    LS->>DB: ค้นหา User (lineUserId)
    LS->>LS: ตรวจสอบสถานะ Conversation

    LS->>CS: getActiveConversation()
    CS->>DB: Query Conversation
    DB-->>CS: Conversation Document
    CS->>CS: appendUserMessage()

    LS->>GS: chat(conversationHistory)
    GS->>DB: searchRelatedTickets() [RAG]
    DB-->>GS: Past resolved tickets
    GS->>GS: buildPrompt(systemPrompt + RAG + history)
    GS->>G: sendMessage()
    G-->>GS: AI Response + [[TYPE:IT_PROBLEM]] [[TOPIC:เน็ตช้า]]
    GS->>GS: parseResponse()

    GS-->>LS: คำตอบ + Quick Reply buttons
    LS->>CS: appendAssistantMessage()
    LS->>L: replyMessage(QuickReply)
    L->>U: แสดงคำตอบ + ปุ่ม "ยังแก้ไม่ได้" / "แก้ได้แล้ว"
```

### กรณีที่ 2: ผู้ใช้กด "ยังแก้ไม่ได้" → Escalate สร้าง Ticket

```mermaid
sequenceDiagram
    participant U as 👤 พนักงาน (LINE)
    participant L as LINE Platform
    participant LS as LineService
    participant SS as supportHandlers
    participant GS as GeminiService
    participant DB as MongoDB
    participant AG as 👥 Admin LINE Group

    U->>L: กดปุ่ม "ยังแก้ไม่ได้"
    L->>LS: handleMessage("ยังแก้ไม่ได้")
    LS->>SS: escalateToSupport()

    SS->>GS: analyzeIssue(history)
    GS-->>SS: สรุปปัญหา (issueSummary)

    SS->>GS: clarifyIssue(summary)
    GS-->>SS: "CLEAR" หรือ คำถามเพิ่มเติม

    alt ถ้าปัญหาชัดเจน (CLEAR)
        SS->>DB: ค้นหาอุปกรณ์ (Asset API)
        SS->>DB: สร้าง Ticket (IT-XXXXXX)
        SS->>GS: getTroubleshootingAdvice()
        GS-->>SS: คำแนะนำเบื้องต้น

        SS->>L: แจ้ง User "สร้าง Ticket สำเร็จ"
        SS->>AG: pushMessage "🚨 Ticket ใหม่!"
        L->>U: แสดง Ticket ID + คำแนะนำ
    else ถ้าข้อมูลไม่พอ
        SS->>L: ถามข้อมูลเพิ่มเติม
        L->>U: แสดงคำถาม
    end
```

### กรณีที่ 3: Admin อัปเดตสถานะ → แจ้ง User ผ่าน LINE

```mermaid
sequenceDiagram
    participant A as 🛡️ IT Admin (Dashboard)
    participant API as REST API
    participant DB as MongoDB
    participant MS as MessagingService
    participant L as LINE Platform
    participant U as 👤 พนักงาน (LINE)

    A->>API: PUT /api/tickets/:id/status<br/>{status: "waiting_user_confirm",<br/>resolutionComment, files}
    API->>DB: อัปเดต Ticket + StatusHistory
    API->>DB: ค้นหา User (employeeId → lineUserId)

    API->>MS: pushMultipleMessages()
    MS->>L: ส่งข้อความ + ไฟล์แนบ + QuickReply
    L->>U: "เจ้าหน้าที่แก้ไขเรียบร้อย"<br/>+ ปุ่ม "ใช่" / "ยังพบปัญหา"
    API-->>A: 200 OK

    alt User ยืนยันแก้ไขสำเร็จ
        U->>L: กด "ใช่ แก้ไขแล้ว"
        L->>API: "ยืนยันปิดเคส IT-XXXXXX"
        API->>DB: status → resolved
        API->>L: ขอให้คะแนน (1-5)
        L->>U: แสดง Quick Reply คะแนน
    else User แจ้งยังไม่ได้
        U->>L: กด "ยังพบปัญหา"
        L->>API: "เคส IT-XXXXXX ยังเสียอยู่"
        API->>DB: status → in_progress (ตีกลับ)
        API->>L: แจ้ง Admin Group
    end
```

---

## 🔄 Conversation State Machine

```mermaid
stateDiagram-v2
    [*] --> active: /start หรือ เริ่มสนทนาใหม่

    active --> active: User ถาม ↔ AI ตอบ
    active --> waiting_escalation_issue: กด "ติดต่อเจ้าหน้าที่"<br/>(ไม่มีประวัติสนทนา)
    active --> waiting_hardware_confirm: AI ตรวจพบอุปกรณ์<br/>ในระบบ Asset
    active --> waiting_troubleshoot_confirm: กด "ยังแก้ไม่ได้"
    active --> waiting_rating: กด "แก้ได้แล้ว"

    waiting_escalation_issue --> waiting_hardware_confirm: User อธิบายปัญหา<br/>+ พบอุปกรณ์
    waiting_escalation_issue --> closed: สร้าง Ticket สำเร็จ<br/>(ไม่มีอุปกรณ์)

    waiting_hardware_confirm --> closed: สร้าง Ticket<br/>(เลือก/ไม่เลือกอุปกรณ์)

    waiting_troubleshoot_confirm --> closed: สร้าง Ticket สำเร็จ

    waiting_rating --> closed: User ให้คะแนน 1-5

    closed --> [*]

    note right of active
        สถานะหลักที่ User 
        คุยกับ AI อยู่
    end note

    note right of waiting_rating
        บังคับให้ User 
        ให้คะแนนก่อนปิด
    end note
```

---

## 🎫 Ticket Lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending: Bot สร้าง Ticket อัตโนมัติ<br/>(escalateToSupport)

    pending --> in_progress: Admin กดรับเรื่อง<br/>(Dashboard)
    
    in_progress --> waiting_user_confirm: Admin แจ้งแก้ไขเสร็จ<br/>+ ส่งไฟล์แนบ (ถ้ามี)
    in_progress --> resolved: Admin ปิดเคสตรง

    waiting_user_confirm --> resolved: User ยืนยัน<br/>"ใช่ แก้ไขแล้ว ✅"
    waiting_user_confirm --> in_progress: User แจ้ง<br/>"ยังเสียอยู่ ❌"<br/>(ตีกลับ)

    resolved --> [*]

    note right of pending
        แจ้ง Admin LINE Group
        ทันทีที่สร้าง
    end note

    note left of waiting_user_confirm
        ส่ง LINE แจ้ง User
        พร้อมปุ่ม Quick Reply
    end note

    note right of resolved
        Auto-close หลัง 72 ชม.
        (TicketAutoClose Worker)
    end note
```

---

## 🧠 AI Pipeline (RAG + Policy)

```mermaid
graph LR
    subgraph "Input Processing"
        MSG["User Message"]
        HIST["Chat History<br/>(ล่าสุด 6 ข้อความ)"]
    end

    subgraph "Context Building"
        SP["System Prompt<br/>(กฎการตอบ + Windows Only)"]
        RAG["RAG Search<br/>ค้น Ticket เก่าที่คล้ายกัน<br/>(MongoDB Text Index)"]
        POL["Company Policy P-02<br/>(inject เมื่อเจอ keyword)"]
    end

    subgraph "AI Processing"
        GEMINI["Google Gemini API<br/>maxOutputTokens: 800<br/>temperature: 0.3<br/>timeout: 30s"]
    end

    subgraph "Output Processing"
        PARSE["parseResponse()<br/>แยก TYPE + TOPIC"]
        RESP["คำตอบภาษาไทย<br/>+ Quick Reply Buttons"]
    end

    subgraph "Safety & Performance"
        SEM["Semaphore<br/>(max 10 concurrent)"]
        RETRY["Retry with Backoff<br/>(1 ครั้ง, 1 วินาที)"]
        TIMEOUT["Timeout Guard<br/>(30 วินาที)"]
    end

    MSG --> SP
    HIST --> SP
    MSG --> RAG
    MSG --> POL
    SP --> GEMINI
    RAG --> GEMINI
    POL --> GEMINI
    SEM --> GEMINI
    RETRY --> GEMINI
    TIMEOUT --> GEMINI
    GEMINI --> PARSE
    PARSE --> RESP

    style GEMINI fill:#4285F4,color:#fff
    style RAG fill:#FF9800,color:#fff
    style POL fill:#9C27B0,color:#fff
```

---

## 📊 Data Model (ERD)

```mermaid
erDiagram
    USER {
        string lineUserId PK "LINE User ID (unique)"
        string name "ชื่อพนักงาน"
        string employeeId "รหัสพนักงาน"
        string department "แผนก"
        string email "อีเมล"
        string phone "เบอร์โทร"
        date registeredAt "วันที่ลงทะเบียน"
        boolean isActive "สถานะใช้งาน"
    }

    CONVERSATION {
        string lineUserId FK "อ้างอิง User"
        string sessionId PK "รหัส Session (unique)"
        array messages "ประวัติแชท"
        string issue "หัวข้อปัญหา"
        boolean resolved "แก้ไขสำเร็จ?"
        number rating "คะแนน 1-5"
        string feedback "ข้อเสนอแนะ"
        boolean escalated "ส่งต่อ IT?"
        number nonItCount "จำนวนคำถามนอกเรื่อง"
        string assetInfo "ข้อมูลอุปกรณ์ (JSON)"
        string status "สถานะ Session"
        date createdAt "เวลาเริ่ม"
        date closedAt "เวลาปิด"
    }

    TICKET {
        string ticketId PK "รหัส Ticket (IT-XXXXXX)"
        string name "ชื่อผู้แจ้ง"
        string employeeId FK "รหัสพนักงาน"
        string department "แผนก"
        string email "อีเมล"
        string phone "เบอร์โทร"
        string issueSummary "สรุปปัญหา (AI)"
        string status "pending/in_progress/waiting_user_confirm/resolved"
        array statusHistory "ประวัติสถานะ"
        string resolutionComment "วิธีแก้ไข (ใช้ใน RAG)"
        array attachments "ไฟล์แนบ"
        date reportedAt "วันที่แจ้ง"
        date acceptedAt "วันที่รับเรื่อง"
        date resolvedAt "วันที่แก้ไขสำเร็จ"
    }

    USER ||--o{ CONVERSATION : "มีหลาย Session"
    USER ||--o{ TICKET : "แจ้งปัญหาหลายครั้ง"
    CONVERSATION ||--o| TICKET : "อาจสร้าง Ticket"
```

---

## 🌐 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/webhook` | LINE Webhook (รับ Events จาก LINE Platform) |
| `GET` | `/api/stats` | สถิติรวม (Users, Conversations, Rating, Resolution Time) |
| `GET` | `/api/conversations` | รายการ Conversations + Pagination + Filter |
| `GET` | `/api/tickets` | รายการ Tickets + Pagination + Filter by Status |
| `GET` | `/api/issues` | Top Issues (ปัญหาที่แจ้งบ่อย) |
| `GET` | `/api/ratings` | การกระจายคะแนน 1-5 |
| `GET` | `/api/trends` | แนวโน้มเคส 7 วันย้อนหลัง |
| `GET` | `/api/activity` | Activity Feed ล่าสุด |
| `GET` | `/api/users` | รายชื่อผู้ใช้ + Search + Pagination |
| `PUT` | `/api/tickets/:id/status` | อัปเดตสถานะ + ส่ง LINE แจ้งเตือน + File Upload |

---

## 🚀 Deployment & Network Topology

```mermaid
graph TB
    subgraph "Internet"
        LINE["LINE Platform<br/>(Webhook)"]
        GOOGLE["Google Gemini API<br/>(generativelanguage.googleapis.com)"]
        GMAIL["Gmail SMTP<br/>(OTP Emails)"]
    end

    subgraph "Cloudflare"
        CF["Cloudflare Tunnel<br/>(cloudflared)"]
    end

    subgraph "Development (Local)"
        DEV["localhost:3002<br/>(Bun.js Dev Server)"]
        DEV_DB["MongoDB<br/>(localhost:27017)"]
    end

    subgraph "Production Server"
        PROD["Production App<br/>(/app - Bun.js)"]
        PROD_DB["MongoDB<br/>(Production)"]
        NGINX["Reverse Proxy"]
    end

    subgraph "Internal Network"
        ASSET["Asset API<br/>(asset.jastel.internal)"]
        DASHBOARD["IT Admin Dashboard<br/>(React + Vite)"]
    end

    LINE -->|"HTTPS POST"| CF
    CF -->|"HTTP tunnel"| DEV
    LINE -->|"HTTPS POST"| NGINX
    NGINX --> PROD

    DEV -->|"HTTPS outbound"| GOOGLE
    PROD -->|"HTTPS outbound"| GOOGLE

    DEV -->|"SMTP"| GMAIL
    PROD -->|"SMTP"| GMAIL

    DEV <--> DEV_DB
    PROD <--> PROD_DB

    DEV -->|"HTTP"| ASSET
    PROD -->|"HTTP"| ASSET

    DASHBOARD -->|"REST API<br/>/api/*"| PROD
    DASHBOARD -->|"REST API<br/>/line-api/*"| DEV

    style LINE fill:#00C300,color:#fff
    style GOOGLE fill:#4285F4,color:#fff
    style CF fill:#F48120,color:#fff
    style DEV fill:#FBF0B2,color:#333
    style PROD fill:#C8E6C9,color:#333
```

### Network Flow สำคัญ:
- **ขาเข้า (Inbound)**: `LINE → Cloudflare Tunnel → localhost:3002` (Dev) หรือ `LINE → Nginx → App` (Prod)
- **ขาออก (Outbound)**: `App → Google Gemini API` ⚠️ *Timeout 30s เกิดตรงนี้ ไม่เกี่ยวกับ Cloudflare*
- **Internal**: `App → Asset API` (เครือข่ายภายในองค์กร)

---

## 📁 Directory Structure

```
line-it-support-bot/
├── src/
│   ├── app.ts                    # Entry point (Express + Webhook + Server)
│   ├── config/
│   │   └── mongodb.ts            # MongoDB connection
│   ├── models/
│   │   ├── User.ts               # พนักงาน (LINE ID ↔ Employee)
│   │   ├── Conversation.ts       # ประวัติแชท + สถานะ Session
│   │   └── Ticket.ts             # เคสที่ส่งต่อ IT
│   ├── routes/
│   │   └── api.ts                # REST API (Dashboard ↔ Backend)
│   ├── services/
│   │   ├── gemini.ts             # 🧠 AI Service (Chat, Image, PDF, RAG)
│   │   ├── line.ts               # LINE Message Router
│   │   ├── ticketAutoClose.ts    # ⏰ Background Worker (Auto-close)
│   │   └── line/
│   │       ├── client.ts         # LINE SDK Client
│   │       ├── constants.ts      # Keywords, Config
│   │       ├── conversation.ts   # Session Management
│   │       ├── messaging.ts      # Reply / Push / QuickReply
│   │       ├── registration.ts   # OTP + Employee Verification
│   │       ├── types.ts          # TypeScript Interfaces
│   │       ├── utils.ts          # Helper Functions
│   │       └── handlers/
│   │           ├── main.ts       # Text Message Handler (หัวใจ)
│   │           ├── media.ts      # Image + PDF Handler
│   │           ├── registration.ts # OTP Flow Handler
│   │           └── support.ts    # Escalation + Rating Handler
│   └── utils/
│       ├── logger.ts             # Daily rotating log (logs/YYYY-MM-DD.log)
│       └── storage.ts            # File upload management
├── docs/
│   ├── ARCHITECTURE.md           # 📖 เอกสารนี้
│   └── QUICK_START.md            # คู่มือเริ่มต้นใช้งาน
├── logs/                         # Log files (auto-generated)
├── uploads/                      # Uploaded files (auto-generated)
├── .gitlab-ci.yml                # CI/CD Pipeline
└── package.json
```

---

## 🛠️ Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | [Bun.js](https://bun.sh/) | High-performance JavaScript runtime |
| **Framework** | Express.js | REST API + Webhook handling |
| **AI Engine** | Google Gemini 3.1 Flash-Lite | LLM for chat, image/PDF analysis, RAG (RAG via MongoDB Text Search) |
| **Database** | MongoDB + Mongoose | Data persistence + Text search (RAG) |
| **Messaging** | LINE Messaging API | Bot communication with employees |
| **Email** | Nodemailer + Gmail SMTP | OTP verification during registration |
| **File Storage** | Multer + Local Disk | Ticket file attachments |
| **Tunnel** | Cloudflare Tunnel | Expose local dev to LINE webhooks |
| **CI/CD** | GitLab CI/CD + Docker | Automated testing + deployment |
| **Frontend** | React + Vite + TailwindCSS | IT Admin Dashboard |
| **Testing** | Bun Test | Built-in test runner |

---

## 🧩 System Components

![System Components](./system_components.png)

### Context Graph (Interaction Flow)

```mermaid
graph TD
    User((พนักงาน - Line)) <--> LineAPI[Line Messaging API]
    LineAPI <--> Backend[Bun.js + Express / src]
    
    subgraph "Core AI & Logic"
        Backend <--> Gemini[Gemini Service / systemInstruction]
        Gemini -.-> Policy[public/policy.md]
        Backend <--> DB[(MongoDB - Mongoose)]
    end
    
    subgraph "Integration & CI/CD"
        Backend <--> AssetAPI[Asset API / 172.16.1.16]
        GitLab[GitLab CI/CD] --> Tests[tests/ folder]
        Tests --> Backend
    end
    
    Backend --> AdminGroup((Admin IT Support Group))
```
