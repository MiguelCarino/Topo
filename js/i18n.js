// i18n. English strings ARE the keys, so a missing entry falls back to correct
// English rather than to a symbol. Locale: ?lang= override > saved choice >
// browser language > en. Japanese deliberately says "PC", not コンピューター.
//
// Two dictionaries, held apart on purpose:
//
//   I18N      — chrome. The mode picker, the setup wizard, simple-mode
//               vocabulary, buttons. Deliberately allowed to be partial: an
//               untranslated button falls back to English and nobody is misled.
//   MESSAGES  — the diagnostic findings and the site report. NOT allowed to be
//               partial. These are printed into a document a customer keeps,
//               and half of one in English is not a fallback, it is a defect.
//               tests/suites/i18n.js enforces that every locale carries every
//               key with every placeholder intact.
//
// Phase 1 covered the chrome only, on the reasoning that technical vocabulary
// is English-dominant. The site report ended that: a Mexican clinic's signed
// deliverable cannot explain a MAC flap in English. MESSAGES is phase 2.
//
// Load order: state -> i18n -> model -> data -> diagnostics -> ui -> report -> app
//
// Self-contained IIFE: the dictionary and the locale stay private and only the
// four helpers below are published on window. This file also owns the bridge to
// the fleet switcher — carino-lang.js owns the *preference*, i18n.js owns the
// *dictionary* and re-applies on 'carino:langchange'.
//
// It is loaded WITHOUT defer, unlike the rest of the fleet, because Topo's own
// scripts (js/app.js in particular) are classic non-deferred scripts that call
// t() at load time; deferring only this file would run it after them. That also
// means carino-lang.js (deferred) has not run yet when this file executes, so
// the fleet preference is picked up on DOMContentLoaded instead — see the
// bridge at the bottom.

(function () {
'use strict';

const I18N = {
    es: {
        'Late shift.': 'Turno nocturno.',
        'Good morning.': 'Buenos días.',
        'Good afternoon.': 'Buenas tardes.',
        'Good evening.': 'Buenas noches.',
        // Mode picker
        'Choose a mode': 'Elige un modo',
        'What are you documenting?': '¿Qué vas a documentar?',
        'Pick the view that fits — you can switch anytime, nothing is lost.': 'Elige la vista que mejor te quede: puedes cambiar cuando quieras, no se pierde nada.',
        'Simple': 'Simple',
        'A simpler view for non-technical people — pick your purpose next': 'Una vista más sencilla para personas no técnicas; luego eliges tu propósito',
        'Full editor': 'Editor completo',
        'Every device and technical detail — IPs, zones, diagnostics': 'Todos los dispositivos y detalles técnicos: IPs, zonas, diagnósticos',
        'Setup wizard': 'Asistente de configuración',
        'Start over: count what you have and the network draws itself': 'Empieza de nuevo: cuenta lo que tienes y la red se dibuja sola',
        'General': 'General',
        'A home or small office — just devices and connections': 'Un hogar u oficina pequeña: solo dispositivos y conexiones',
        'Imagenology': 'Imagenología',
        'Medical imaging — modalities, PACS and viewing stations': 'Imagen médica: modalidades, PACS y estaciones de visualización',
        'Something missing? Try another mode': '¿Falta algo? Prueba otro modo',
        // Setup wizard
        'What do you have?': '¿Qué tienes?',
        "Count what's in the building — the network draws itself. You can rename and adjust everything afterwards.": 'Cuenta lo que hay en el lugar: la red se dibuja sola. Después puedes renombrar y ajustar todo.',
        'Start empty': 'Empezar vacío',
        '✨ Build my network': '✨ Crear mi red',
        'Computers / laptops': 'Computadoras / laptops',
        'Smart TVs & devices': 'Smart TVs y dispositivos',
        'Printers': 'Impresoras',
        'Cameras': 'Cámaras',
        'Wi-Fi points': 'Puntos Wi-Fi',
        'Switches': 'Switches',
        'Servers / NAS': 'Servidores / NAS',
        'Desk phones': 'Teléfonos de escritorio',
        'Modalities (CT, MR, US…)': 'Modalidades (TC, RM, US…)',
        'Firewalls': 'Firewalls',
        'VPN gateways': 'Puertas de enlace VPN',
        'L3 switches': 'Switches L3',
        'Load balancers': 'Balanceadores de carga',
        'Edge gateways': 'Gateways de borde',
        'Virtual machines': 'Máquinas virtuales',
        'Containers': 'Contenedores',
        'Internet / cloud links': 'Enlaces a internet / nube',
        'Other devices': 'Otros dispositivos',
        // Built node names (become editable document data)
        'Router': 'Router',
        'Computer': 'Computadora',
        'Smart Device': 'Dispositivo inteligente',
        'Printer': 'Impresora',
        'Camera': 'Cámara',
        'Wireless AP': 'Punto de acceso',
        'Switch': 'Switch',
        'Server': 'Servidor',
        'VoIP Phone': 'Teléfono VoIP',
        'Modality': 'Modalidad',
        'Firewall': 'Firewall',
        'VPN Gateway': 'Puerta de enlace VPN',
        'L3 Switch': 'Switch L3',
        'Load Balancer': 'Balanceador de carga',
        'Edge Gateway': 'Gateway de borde',
        'VM': 'VM',
        'Container': 'Contenedor',
        'Cloud': 'Nube',
        'Device': 'Dispositivo',
        // Simple-mode vocabulary
        'Devices': 'Dispositivos',
        'Examples': 'Ejemplos',
        'Connection': 'Conexión',
        'Network cable': 'Cable de red',
        'Fiber cable': 'Cable de fibra',
        'Wi-Fi': 'Wi-Fi',
        'Through power outlets': 'Por enchufes (PLC)',
        'VPN (internet tunnel)': 'VPN (túnel por internet)',
        'PACS / Archive': 'PACS / Archivo',
        'Viewing Station': 'Estación de visualización',
        'Modality (CT/MR/US)': 'Modalidad (TC/RM/US)',
        'Workstation': 'Estación de trabajo',
        'IoT Device': 'Dispositivo IoT',
        'IP Camera': 'Cámara IP',
        // Simple-mode chrome
        'Name': 'Nombre',
        'Delete Selected': 'Eliminar selección',
        'Select a node or link to configure.': 'Selecciona un dispositivo o conexión para configurarlo.',
        'A whole network. Replaces the canvas.': 'Una red completa. Reemplaza el lienzo.',
        'Undo': 'Deshacer',
        'Redo': 'Rehacer',
        'Tidy': 'Ordenar',
        'Untidy': 'Desordenar',
        'Clear': 'Limpiar',
        'Export': 'Exportar',
        'Copy link': 'Copiar enlace',
        'short URL': 'URL corta',
        'PNG image': 'Imagen PNG',
    },
    'pt-BR': {
        'Late shift.': 'Turno da noite.',
        'Good morning.': 'Bom dia.',
        'Good afternoon.': 'Boa tarde.',
        'Good evening.': 'Boa noite.',
        'Choose a mode': 'Escolha um modo',
        'What are you documenting?': 'O que você vai documentar?',
        'Pick the view that fits — you can switch anytime, nothing is lost.': 'Escolha a visão que combina com você: pode trocar quando quiser, nada se perde.',
        'Simple': 'Simples',
        'A simpler view for non-technical people — pick your purpose next': 'Uma visão mais simples para quem não é técnico; depois escolha seu propósito',
        'Full editor': 'Editor completo',
        'Every device and technical detail — IPs, zones, diagnostics': 'Todos os dispositivos e detalhes técnicos: IPs, zonas, diagnósticos',
        'Setup wizard': 'Assistente de configuração',
        'Start over: count what you have and the network draws itself': 'Comece de novo: conte o que você tem e a rede se desenha sozinha',
        'General': 'Geral',
        'A home or small office — just devices and connections': 'Uma casa ou escritório pequeno: só dispositivos e conexões',
        'Imagenology': 'Imagenologia',
        'Medical imaging — modalities, PACS and viewing stations': 'Imagem médica: modalidades, PACS e estações de visualização',
        'Something missing? Try another mode': 'Faltou algo? Tente outro modo',
        'What do you have?': 'O que você tem?',
        "Count what's in the building — the network draws itself. You can rename and adjust everything afterwards.": 'Conte o que há no local: a rede se desenha sozinha. Depois você pode renomear e ajustar tudo.',
        'Start empty': 'Começar vazio',
        '✨ Build my network': '✨ Criar minha rede',
        'Computers / laptops': 'Computadores / notebooks',
        'Smart TVs & devices': 'Smart TVs e dispositivos',
        'Printers': 'Impressoras',
        'Cameras': 'Câmeras',
        'Wi-Fi points': 'Pontos Wi-Fi',
        'Switches': 'Switches',
        'Servers / NAS': 'Servidores / NAS',
        'Desk phones': 'Telefones de mesa',
        'Modalities (CT, MR, US…)': 'Modalidades (TC, RM, US…)',
        'Firewalls': 'Firewalls',
        'VPN gateways': 'Gateways VPN',
        'L3 switches': 'Switches L3',
        'Load balancers': 'Balanceadores de carga',
        'Edge gateways': 'Gateways de borda',
        'Virtual machines': 'Máquinas virtuais',
        'Containers': 'Contêineres',
        'Internet / cloud links': 'Links de internet / nuvem',
        'Other devices': 'Outros dispositivos',
        'Router': 'Roteador',
        'Computer': 'Computador',
        'Smart Device': 'Dispositivo inteligente',
        'Printer': 'Impressora',
        'Camera': 'Câmera',
        'Wireless AP': 'Ponto de acesso',
        'Switch': 'Switch',
        'Server': 'Servidor',
        'VoIP Phone': 'Telefone VoIP',
        'Modality': 'Modalidade',
        'Firewall': 'Firewall',
        'VPN Gateway': 'Gateway VPN',
        'L3 Switch': 'Switch L3',
        'Load Balancer': 'Balanceador de carga',
        'Edge Gateway': 'Gateway de borda',
        'VM': 'VM',
        'Container': 'Contêiner',
        'Cloud': 'Nuvem',
        'Device': 'Dispositivo',
        'Devices': 'Dispositivos',
        'Examples': 'Exemplos',
        'Connection': 'Conexão',
        'Network cable': 'Cabo de rede',
        'Fiber cable': 'Cabo de fibra',
        'Wi-Fi': 'Wi-Fi',
        'Through power outlets': 'Pela tomada (PLC)',
        'VPN (internet tunnel)': 'VPN (túnel pela internet)',
        'PACS / Archive': 'PACS / Arquivo',
        'Viewing Station': 'Estação de visualização',
        'Modality (CT/MR/US)': 'Modalidade (TC/RM/US)',
        'Workstation': 'Estação de trabalho',
        'IoT Device': 'Dispositivo IoT',
        'IP Camera': 'Câmera IP',
        'Name': 'Nome',
        'Delete Selected': 'Excluir seleção',
        'Select a node or link to configure.': 'Selecione um dispositivo ou conexão para configurar.',
        'A whole network. Replaces the canvas.': 'Uma rede completa. Substitui a tela.',
        'Undo': 'Desfazer',
        'Redo': 'Refazer',
        'Tidy': 'Organizar',
        'Untidy': 'Desorganizar',
        'Clear': 'Limpar',
        'Export': 'Exportar',
        'Copy link': 'Copiar link',
        'short URL': 'URL curta',
        'PNG image': 'Imagem PNG',
    },
    ru: {
        'Late shift.': 'Ночная смена.',
        'Good morning.': 'Доброе утро.',
        'Good afternoon.': 'Добрый день.',
        'Good evening.': 'Добрый вечер.',
        'Choose a mode': 'Выберите режим',
        'What are you documenting?': 'Что вы документируете?',
        'Pick the view that fits — you can switch anytime, nothing is lost.': 'Выберите подходящий вид: переключаться можно в любой момент, ничего не потеряется.',
        'Simple': 'Простой',
        'A simpler view for non-technical people — pick your purpose next': 'Упрощённый вид для нетехнических пользователей; затем выберите назначение',
        'Full editor': 'Полный редактор',
        'Every device and technical detail — IPs, zones, diagnostics': 'Все устройства и технические детали: IP, зоны, диагностика',
        'Setup wizard': 'Мастер настройки',
        'Start over: count what you have and the network draws itself': 'Начать заново: посчитайте, что у вас есть, и сеть нарисуется сама',
        'General': 'Общий',
        'A home or small office — just devices and connections': 'Дом или небольшой офис: только устройства и соединения',
        'Imagenology': 'Лучевая диагностика',
        'Medical imaging — modalities, PACS and viewing stations': 'Медицинская визуализация: модальности, PACS и станции просмотра',
        'Something missing? Try another mode': 'Чего-то не хватает? Попробуйте другой режим',
        'What do you have?': 'Что у вас есть?',
        "Count what's in the building — the network draws itself. You can rename and adjust everything afterwards.": 'Посчитайте, что есть в здании: сеть нарисуется сама. Потом всё можно переименовать и настроить.',
        'Start empty': 'Начать с пустого',
        '✨ Build my network': '✨ Создать мою сеть',
        'Computers / laptops': 'Компьютеры / ноутбуки',
        'Smart TVs & devices': 'Смарт-ТВ и умные устройства',
        'Printers': 'Принтеры',
        'Cameras': 'Камеры',
        'Wi-Fi points': 'Точки Wi-Fi',
        'Switches': 'Коммутаторы',
        'Servers / NAS': 'Серверы / NAS',
        'Desk phones': 'Настольные телефоны',
        'Modalities (CT, MR, US…)': 'Модальности (КТ, МРТ, УЗИ…)',
        'Firewalls': 'Межсетевые экраны',
        'VPN gateways': 'VPN-шлюзы',
        'L3 switches': 'Коммутаторы L3',
        'Load balancers': 'Балансировщики нагрузки',
        'Edge gateways': 'Пограничные шлюзы',
        'Virtual machines': 'Виртуальные машины',
        'Containers': 'Контейнеры',
        'Internet / cloud links': 'Интернет / облачные каналы',
        'Other devices': 'Другие устройства',
        'Router': 'Роутер',
        'Computer': 'Компьютер',
        'Smart Device': 'Умное устройство',
        'Printer': 'Принтер',
        'Camera': 'Камера',
        'Wireless AP': 'Точка доступа',
        'Switch': 'Коммутатор',
        'Server': 'Сервер',
        'VoIP Phone': 'VoIP-телефон',
        'Modality': 'Модальность',
        'Firewall': 'Межсетевой экран',
        'VPN Gateway': 'VPN-шлюз',
        'L3 Switch': 'Коммутатор L3',
        'Load Balancer': 'Балансировщик нагрузки',
        'Edge Gateway': 'Пограничный шлюз',
        'VM': 'ВМ',
        'Container': 'Контейнер',
        'Cloud': 'Облако',
        'Device': 'Устройство',
        'Devices': 'Устройства',
        'Examples': 'Примеры',
        'Connection': 'Соединение',
        'Network cable': 'Сетевой кабель',
        'Fiber cable': 'Оптический кабель',
        'Wi-Fi': 'Wi-Fi',
        'Through power outlets': 'Через розетки (PLC)',
        'VPN (internet tunnel)': 'VPN (туннель через интернет)',
        'PACS / Archive': 'PACS / Архив',
        'Viewing Station': 'Станция просмотра',
        'Modality (CT/MR/US)': 'Модальность (КТ/МРТ/УЗИ)',
        'Workstation': 'Рабочая станция',
        'IoT Device': 'IoT-устройство',
        'IP Camera': 'IP-камера',
        'Name': 'Название',
        'Delete Selected': 'Удалить выбранное',
        'Select a node or link to configure.': 'Выберите устройство или соединение для настройки.',
        'A whole network. Replaces the canvas.': 'Целая сеть. Заменяет холст.',
        'Undo': 'Отменить',
        'Redo': 'Повторить',
        'Tidy': 'Упорядочить',
        'Untidy': 'Как было',
        'Clear': 'Очистить',
        'Export': 'Экспорт',
        'Copy link': 'Копировать ссылку',
        'short URL': 'короткий URL',
        'PNG image': 'PNG-изображение',
    },
    ja: {
        'Late shift.': '夜勤お疲れさま。',
        'Good morning.': 'おはようございます。',
        'Good afternoon.': 'こんにちは。',
        'Good evening.': 'こんばんは。',
        'Choose a mode': 'モードを選択',
        'What are you documenting?': '何を記録しますか？',
        'Pick the view that fits — you can switch anytime, nothing is lost.': '合うビューを選んでください。いつでも切り替えられ、何も失われません。',
        'Simple': 'シンプル',
        'A simpler view for non-technical people — pick your purpose next': '技術に詳しくない方向けのシンプルなビュー。次に用途を選びます',
        'Full editor': 'フルエディター',
        'Every device and technical detail — IPs, zones, diagnostics': 'すべてのデバイスと技術詳細 — IP、ゾーン、診断',
        'Setup wizard': 'セットアップウィザード',
        'Start over: count what you have and the network draws itself': '最初から: 機器を数えるとネットワークが自動で描かれます',
        'General': '一般',
        'A home or small office — just devices and connections': '家庭や小規模オフィス — デバイスと接続だけ',
        'Imagenology': '画像診断',
        'Medical imaging — modalities, PACS and viewing stations': '医用画像 — モダリティ、PACS、読影端末',
        'Something missing? Try another mode': '足りない？別のモードを試す',
        'What do you have?': '何がありますか？',
        "Count what's in the building — the network draws itself. You can rename and adjust everything afterwards.": '建物内の機器を数えるとネットワークが自動で描かれます。名前や配置は後から自由に変更できます。',
        'Start empty': '空から始める',
        '✨ Build my network': '✨ ネットワークを作成',
        'Computers / laptops': 'PC・ノートPC',
        'Smart TVs & devices': 'スマートTV・スマート機器',
        'Printers': 'プリンター',
        'Cameras': 'カメラ',
        'Wi-Fi points': 'Wi-Fiアクセスポイント',
        'Switches': 'スイッチ',
        'Servers / NAS': 'サーバー・NAS',
        'Desk phones': '固定電話 (VoIP)',
        'Modalities (CT, MR, US…)': 'モダリティ (CT・MR・USなど)',
        'Firewalls': 'ファイアウォール',
        'VPN gateways': 'VPNゲートウェイ',
        'L3 switches': 'L3スイッチ',
        'Load balancers': 'ロードバランサー',
        'Edge gateways': 'エッジゲートウェイ',
        'Virtual machines': '仮想マシン',
        'Containers': 'コンテナ',
        'Internet / cloud links': 'インターネット・クラウド回線',
        'Other devices': 'その他の機器',
        'Router': 'ルーター',
        'Computer': 'PC',
        'Smart Device': 'スマート機器',
        'Printer': 'プリンター',
        'Camera': 'カメラ',
        'Wireless AP': 'アクセスポイント',
        'Switch': 'スイッチ',
        'Server': 'サーバー',
        'VoIP Phone': 'VoIP電話',
        'Modality': 'モダリティ',
        'Firewall': 'ファイアウォール',
        'VPN Gateway': 'VPNゲートウェイ',
        'L3 Switch': 'L3スイッチ',
        'Load Balancer': 'ロードバランサー',
        'Edge Gateway': 'エッジゲートウェイ',
        'VM': 'VM',
        'Container': 'コンテナ',
        'Cloud': 'クラウド',
        'Device': '機器',
        'Devices': 'デバイス',
        'Examples': '例',
        'Connection': '接続',
        'Network cable': 'LANケーブル',
        'Fiber cable': '光ケーブル',
        'Wi-Fi': 'Wi-Fi',
        'Through power outlets': 'コンセント経由 (PLC)',
        'VPN (internet tunnel)': 'VPN (インターネットトンネル)',
        'PACS / Archive': 'PACS・アーカイブ',
        'Viewing Station': '読影端末',
        'Modality (CT/MR/US)': 'モダリティ (CT/MR/US)',
        'Workstation': 'ワークステーション',
        'IoT Device': 'IoT機器',
        'IP Camera': 'IPカメラ',
        'Name': '名前',
        'Delete Selected': '選択を削除',
        'Select a node or link to configure.': '設定するデバイスまたは接続を選択してください。',
        'A whole network. Replaces the canvas.': 'ネットワーク一式。キャンバスを置き換えます。',
        'Undo': '元に戻す',
        'Redo': 'やり直す',
        'Tidy': '整列',
        'Untidy': '元の配置',
        'Clear': 'クリア',
        'Export': 'エクスポート',
        'Copy link': 'リンクをコピー',
        'short URL': '短縮URL',
        'PNG image': 'PNG画像',
    },
};

// ---- Diagnostic messages ----
// Phase 2, and the reason it happened: the site report (js/report.js) prints
// these sentences into a document a customer keeps, so "technical vocabulary is
// English-dominant" stopped being an acceptable answer. Translating the
// evaluators translates the Diagnostics panel and the alert list at the same
// time, because all three read the same functions.
//
// Kept apart from the chrome dictionaries above for one reason: every locale
// here must carry EVERY key, and tests/suites/i18n.js enforces that plus
// placeholder parity. The chrome dictionaries are deliberately allowed to be
// partial; a half-translated finding in a signed report is not the same thing
// as a half-translated button.
//
// Placeholders are named, never positional, so a translation may reorder them.
// Plurals are separate keys rather than an inflection rule — Russian's three
// forms do not survive a two-branch helper, so those translations are written
// to read correctly with a numeral in front of them whatever the count.
const MESSAGES = {
    es: {
        // Interfaces
        'No interfaces assigned. This node is acting as an L2 backplane.': 'Sin interfaces asignadas. Este nodo funciona como plano de conmutación L2.',
        'No interfaces configured.': 'Sin interfaces configuradas.',
        'Invalid CIDR on: {names}': 'CIDR inválido en: {names}',
        'Interfaces exist, but none has a valid CIDR IP.': 'Hay interfaces, pero ninguna tiene una IP CIDR válida.',
        '{n} valid interface configured.': '{n} interfaz válida configurada.',
        '{n} valid interfaces configured.': '{n} interfaces válidas configuradas.',
        // Multi-homing
        'L2 backplane nodes do not hold IPs to duplicate.': 'Los nodos de plano L2 no tienen IPs que se puedan duplicar.',
        'Each interface sits on its own subnet.': 'Cada interfaz está en su propia subred.',
        'MAC flapping: {names} both sit on {net} in the same broadcast domain. The switch sees this MAC on two ports and rewrites its CAM table, so new outbound ARP gets dropped while existing TCP sessions survive. Fix: unplug one, set arp_ignore=1 / arp_announce=2, or bond the NICs.':
            'Oscilación de MAC: {names} están ambas en {net} dentro del mismo dominio de difusión. El switch ve esta MAC en dos puertos y reescribe su tabla CAM, por lo que el ARP saliente nuevo se descarta mientras las sesiones TCP existentes sobreviven. Solución: desconecta una, configura arp_ignore=1 / arp_announce=2, o agrega las NICs en un bond.',
        'ARP flux: {names} share subnet {net}. The kernel answers ARP for these IPs on both NICs (weak host model). They reach different broadcast domains, so switches will not flap — but set arp_ignore=1 / arp_announce=2 to bind ARP to its own interface.':
            'Flujo ARP: {names} comparten la subred {net}. El kernel responde ARP por estas IPs en ambas NICs (modelo de host débil). Alcanzan dominios de difusión distintos, así que los switches no oscilarán, pero configura arp_ignore=1 / arp_announce=2 para atar el ARP a su propia interfaz.',
        // Ports
        'No links attached.': 'Sin enlaces conectados.',
        '{n} link(s) are not bound to an interface. Select the link and pick a port.': '{n} enlace(s) no están asociados a una interfaz. Selecciona el enlace y elige un puerto.',
        'Two cables on one port: {names}. A physical port carries one link.': 'Dos cables en un puerto: {names}. Un puerto físico lleva un solo enlace.',
        '{n} link(s) land on interfaces this node no longer has. Rebind them or raise the port count.': '{n} enlace(s) terminan en interfaces que este nodo ya no tiene. Reasígnalos o aumenta el número de puertos.',
        '{used} cables on a {total}-port {type}. Raise the port count or add a switch.': '{used} cables en un {type} de {total} puertos. Aumenta el número de puertos o agrega un switch.',
        '{used} of {total} ports in use.': '{used} de {total} puertos en uso.',
        '{used} of {total} ports in use, {n} wireless client.': '{used} de {total} puertos en uso, {n} cliente inalámbrico.',
        '{used} of {total} ports in use, {n} wireless clients.': '{used} de {total} puertos en uso, {n} clientes inalámbricos.',
        '{n} link(s) on distinct interfaces.': '{n} enlace(s) en interfaces distintas.',
        // Radio
        '{iface} is wired but carries the Wi-Fi link to {peer}': '{iface} es cableada pero lleva el enlace Wi-Fi hacia {peer}',
        '{iface} is a radio but carries the {medium} cable to {peer}': '{iface} es una radio pero lleva el cable {medium} hacia {peer}',
        '{problems}. Wi-Fi needs a wireless NIC (wlan0, wlp1s0); cables need an Ethernet port.': '{problems}. El Wi-Fi necesita una NIC inalámbrica (wlan0, wlp1s0); los cables necesitan un puerto Ethernet.',
        'Links match their interface type.': 'Los enlaces coinciden con el tipo de su interfaz.',
        'Links match their interface type ({n} radio).': 'Los enlaces coinciden con el tipo de su interfaz ({n} radio).',
        'Links match their interface type ({n} radios).': 'Los enlaces coinciden con el tipo de su interfaz ({n} radios).',
        // Bonding
        'No bonded interfaces.': 'Sin interfaces agregadas.',
        '{bond} lists {n} member interface that no longer exists. Remove it from the bond, or recreate the NIC.': '{bond} declara {n} interfaz miembro que ya no existe. Quítala del bond o vuelve a crear la NIC.',
        '{bond} lists {n} member interfaces that no longer exist. Remove them from the bond, or recreate the NICs.': '{bond} declara {n} interfaces miembro que ya no existen. Quítalas del bond o vuelve a crear las NICs.',
        '{bond} has {n} member. A bond of one is a NIC with extra steps — it buys no redundancy and no bandwidth. Add a second member or unbond it.':
            '{bond} tiene {n} miembro. Un bond de uno es una NIC con pasos de más: no aporta redundancia ni ancho de banda. Agrega un segundo miembro o deshaz el bond.',
        '{names} still hold an address inside {bond}. Members are L2 only — the address belongs on the bond. Leave it on the members and the kernel answers ARP on each of them, which is the flux the bond was supposed to fix.':
            '{names} todavía tienen una dirección dentro de {bond}. Los miembros son solo L2: la dirección va en el bond. Si se queda en los miembros, el kernel responde ARP en cada uno, que es justo el flujo que el bond debía corregir.',
        '{names} is a radio. A Wi-Fi association cannot be a bond member — the two ends negotiate a single association, not a trunk.':
            '{names} es una radio. Una asociación Wi-Fi no puede ser miembro de un bond: los dos extremos negocian una sola asociación, no un troncal.',
        'LACP: {bond} members land in different broadcast domains. 802.3ad negotiates a LAG with one switch — split across two independent switches, the peers never bring the aggregate up. Use active-backup, or stack/MLAG the switches so they present as one.':
            'LACP: los miembros de {bond} caen en dominios de difusión distintos. 802.3ad negocia un LAG con un solo switch; repartido entre dos switches independientes, los extremos nunca levantan el agregado. Usa active-backup, o apila los switches (stack/MLAG) para que se presenten como uno.',
        '{bond} bonds {n} NICs ({mode}). One MAC, one address — no ARP flux to answer for.': '{bond} agrega {n} NICs ({mode}). Una MAC, una dirección: sin flujo ARP del que responder.',
        // Hardware addresses
        'No hardware addresses recorded on this node.': 'No hay direcciones físicas registradas en este nodo.',
        '{names} carries a broadcast or multicast address. An interface cannot source frames from a group address — that value belongs in a destination, not on a NIC.':
            '{names} tiene una dirección de difusión o multidifusión. Una interfaz no puede originar tramas desde una dirección de grupo: ese valor va en un destino, no en una NIC.',
        '{mac} is on {where}. Two interfaces in one broadcast domain cannot hold the same address — the switch rewrites its CAM table on every frame, which is the flapping this tool reports from the other direction. Clone, restored backup or a hand-typed address are the usual causes.':
            '{mac} está en {where}. Dos interfaces en un mismo dominio de difusión no pueden tener la misma dirección: el switch reescribe su tabla CAM con cada trama, que es la oscilación que esta herramienta reporta desde el otro lado. Las causas habituales son un clon, un respaldo restaurado o una dirección escrita a mano.',
        'Every address here is locally administered ({names}). That is correct for a VM, a bond or a randomising client, and wrong for an inventory — the vendor prefix on these is made up.':
            'Todas las direcciones aquí son de administración local ({names}). Eso es correcto para una VM, un bond o un cliente que aleatoriza, y equivocado para un inventario: el prefijo de fabricante de estas es inventado.',
        '{names} is locally administered — randomised or hand-set, so the vendor prefix says nothing.': '{names} es de administración local (aleatoria o puesta a mano), así que el prefijo de fabricante no dice nada.',
        '{names} are locally administered — randomised or hand-set, so the vendor prefix says nothing.': '{names} son de administración local (aleatorias o puestas a mano), así que el prefijo de fabricante no dice nada.',
        '{n} burned-in address, no duplicates on the map.': '{n} dirección grabada de fábrica, sin duplicados en el mapa.',
        '{n} burned-in addresses, no duplicates on the map.': '{n} direcciones grabadas de fábrica, sin duplicados en el mapa.',
        '{n} burned-in address, no duplicates on the map ({vendors}).': '{n} dirección grabada de fábrica, sin duplicados en el mapa ({vendors}).',
        '{n} burned-in addresses, no duplicates on the map ({vendors}).': '{n} direcciones grabadas de fábrica, sin duplicados en el mapa ({vendors}).',
        // Gateway
        'L2 backplane nodes do not require a gateway.': 'Los nodos de plano L2 no requieren puerta de enlace.',
        'No gateway configured.': 'Sin puerta de enlace configurada.',
        'Default route placeholder configured; cloud/internet node is reachable.': 'Marcador de ruta por defecto configurado; el nodo de nube/internet es alcanzable.',
        'Default route placeholder configured.': 'Marcador de ruta por defecto configurado.',
        'Invalid gateway IP: {gw}': 'IP de puerta de enlace inválida: {gw}',
        'Gateway {gw} was not found on any node/interface.': 'La puerta de enlace {gw} no se encontró en ningún nodo o interfaz.',
        'Gateway {gw} found on {node} and is reachable.': 'Puerta de enlace {gw} encontrada en {node} y alcanzable.',
        'Gateway {gw} exists on {node}, but is not reachable from this node.': 'La puerta de enlace {gw} existe en {node}, pero no es alcanzable desde este nodo.',
        // DNS
        'L2 backplane nodes do not require DNS.': 'Los nodos de plano L2 no requieren DNS.',
        'No DNS server configured.': 'Sin servidor DNS configurado.',
        '{ip}: invalid DNS IP.': '{ip}: IP de DNS inválida.',
        '{ip}: found on {node}, reachable, DNS port OK.': '{ip}: encontrado en {node}, alcanzable, puerto DNS correcto.',
        '{ip}: found on {node}, but not reachable.': '{ip}: encontrado en {node}, pero no alcanzable.',
        '{ip}: reachable, but DNS port 53 appears closed.': '{ip}: alcanzable, pero el puerto DNS 53 parece cerrado.',
        '{ip}: private DNS server not found in topology.': '{ip}: servidor DNS privado no encontrado en la topología.',
        '{ip}: public DNS; cloud/internet path appears reachable.': '{ip}: DNS público; la ruta a nube/internet parece alcanzable.',
        '{ip}: public DNS, but no cloud/internet path was found.': '{ip}: DNS público, pero no se encontró ruta a nube/internet.',
        // Trace port
        'Port filter off — trace is evaluating IP reachability only (port {port} ignored).': 'Filtro de puerto desactivado: el trazo evalúa solo alcanzabilidad IP (se ignora el puerto {port}).',
        'No trace port entered. Trace is evaluating IP reachability only.': 'No se indicó puerto de trazo. El trazo evalúa solo alcanzabilidad IP.',
        'No trace port requested.': 'No se solicitó puerto de trazo.',
        'Invalid trace port: {port}': 'Puerto de trazo inválido: {port}',
        'Transit device; service port is not evaluated as an endpoint.': 'Dispositivo de tránsito; el puerto de servicio no se evalúa como extremo.',
        'No allowed ports defined; treating as open.': 'Sin puertos permitidos definidos; se trata como abierto.',
        'Allowed Ports field is invalid: {ports}': 'El campo de puertos permitidos es inválido: {ports}',
        'Port {port} is allowed by this node.': 'El puerto {port} está permitido por este nodo.',
        "Port {port} is not listed in this node's Allowed Ports.": 'El puerto {port} no aparece en los puertos permitidos de este nodo.',
        // Topology-wide
        'Gateway {gw} is unreachable.': 'La puerta de enlace {gw} no es alcanzable.',
        'Invalid gateway format.': 'Formato de puerta de enlace inválido.',
        '{ip} shared by {names}.': '{ip} compartida por {names}.',
        '{a} ({ifaceA}) and {b} ({ifaceB}) are cabled together but sit on different subnets ({netA} vs {netB}).': '{a} ({ifaceA}) y {b} ({ifaceB}) están cableados entre sí pero en subredes distintas ({netA} vs {netB}).',
        'the link between {a} and {b} closes a switching loop. Broadcast storm risk unless STP is enabled.': 'el enlace entre {a} y {b} cierra un bucle de conmutación. Riesgo de tormenta de difusión salvo que STP esté habilitado.',
        // Check names — the column the report prints beside each finding
        'Interfaces': 'Interfaces',
        'Multi-Homing': 'Multi-conexión',
        'Bond': 'Bond',
        'Ports': 'Puertos',
        'Radio': 'Radio',
        'MAC': 'MAC',
        'Gateway': 'Puerta de enlace',
        'DNS': 'DNS',
        'Trace Port': 'Puerto de trazo',
        'Cabling': 'Cableado',
        'IP Conflict': 'Conflicto de IP',
        'L2 loop': 'Bucle L2',
        // ---- Site report ----
        // Document furniture, held here rather than with the chrome above because
        // it is printed into the deliverable: every locale must carry all of it.
        'Custom Node': 'Nodo personalizado',   // the one palette name the reporter path never needed until the inventory listed it
        'Site report': 'Informe de sitio',
        'printable': 'imprimible',
        'The findings, the inventory and the diagram as one printable document. Everything here is optional — it only fills in the header.':
            'Los hallazgos, el inventario y el diagrama en un solo documento imprimible. Todo esto es opcional: sólo llena el encabezado.',
        'Cancel': 'Cancelar',
        '📋 Open report': '📋 Abrir informe',
        'Site': 'Sitio',
        'Client': 'Cliente',
        'Prepared by': 'Elaborado por',
        'Reference': 'Referencia',
        'Date': 'Fecha',
        'Scope & notes': 'Alcance y notas',
        'What was surveyed, what was not, and anything the reader needs to know.':
            'Qué se revisó, qué no, y cualquier cosa que el lector necesite saber.',
        'Network documentation report': 'Informe de documentación de red',
        'Site not named': 'Sitio sin nombre',
        'Print / Save as PDF': 'Imprimir / Guardar como PDF',
        'Summary': 'Resumen',
        'Devices': 'Dispositivos',
        'Connections': 'Conexiones',
        'Subnets': 'Subredes',
        'Critical': 'Crítico',
        'Advisory': 'Advertencia',
        'Findings': 'Hallazgos',
        'Severity': 'Severidad',
        'Device': 'Dispositivo',
        'Check': 'Verificación',
        'Finding': 'Hallazgo',
        'No faults were raised by the documented configuration.': 'La configuración documentada no generó ninguna falla.',
        'Every automated check passed against the topology as recorded. That is a statement about the drawing, not a clean bill of health for the network — see Scope and method.':
            'Todas las verificaciones automáticas pasaron sobre la topología tal como fue registrada. Eso es una afirmación sobre el diagrama, no un certificado de salud de la red: véase Alcance y método.',
        'Topology': 'Topología',
        'Network topology diagram': 'Diagrama de topología de red',
        'Device inventory': 'Inventario de dispositivos',
        'Type': 'Tipo',
        'OS / firmware': 'SO / firmware',
        'Allowed': 'Permitidos',
        'none recorded': 'no registrado',
        'bond': 'agregado',
        'bond member': 'miembro del agregado',
        'radio': 'radio',
        'From': 'Desde',
        'To': 'Hasta',
        'Interface': 'Interfaz',
        'Medium': 'Medio',
        'No connections recorded.': 'No hay conexiones registradas.',
        'Addressing': 'Direccionamiento',
        'Network': 'Red',
        'Kind': 'Tipo',
        'Members': 'Miembros',
        'Private': 'Privada',
        'Public / routable': 'Pública / enrutable',
        'No addressing recorded.': 'No hay direccionamiento registrado.',
        'Scope and method': 'Alcance y método',
        'This report describes the network as documented during the survey. Findings are derived from the recorded topology, addressing and interface configuration — no device was scanned, probed or logged into to produce them, and nothing here was measured against live traffic.':
            'Este informe describe la red tal como fue documentada durante el levantamiento. Los hallazgos se derivan de la topología, el direccionamiento y la configuración de interfaces registrados: para producirlos no se escaneó, sondeó ni accedió a ningún equipo, y nada aquí se midió contra tráfico real.',
        'A finding therefore means the configuration as recorded would cause the described behaviour. Where the documentation is incomplete, the corresponding check is silent rather than passing.':
            'Por lo tanto, un hallazgo significa que la configuración registrada produciría el comportamiento descrito. Donde la documentación está incompleta, la verificación correspondiente calla en lugar de aprobar.',
        'Generated with Topo · topo.carino.systems': 'Generado con Topo · topo.carino.systems',
        // Media, as the connections table names them.
        'UTP copper': 'Cobre UTP',
        'Fibre optic': 'Fibra óptica',
        'Wireless': 'Inalámbrico',
        'Powerline': 'Línea eléctrica',
        'VPN tunnel': 'Túnel VPN',
        'Unspecified': 'Sin especificar',
        // ---- Binder report (js/report.js, the estate document) ----
        '📋 Binder report': '📋 Informe del binder',
        'Binder report': 'Informe del binder',
        'Every saved network as one document: the estate totals, the findings across all sites, the addressing they share, then each network in full.':
            'Todas las redes guardadas en un solo documento: los totales del conjunto, los hallazgos de todos los sitios, el direccionamiento que comparten y después cada red completa.',
        'Open binder report': 'Abrir informe del binder',
        'Open report': 'Abrir informe',
        'Include a diagram for each site': 'Incluir un diagrama de cada sitio',
        'Renders each network in turn — slower, and the file gets much larger.':
            'Dibuja cada red por turno: más lento, y el archivo queda mucho más grande.',
        'Estate documentation report': 'Informe de documentación del conjunto',
        'Estate not named': 'Conjunto sin nombre',
        'Sites': 'Sitios',
        'Site': 'Sitio',
        'Findings across the estate': 'Hallazgos de todo el conjunto',
        'Estate addressing': 'Direccionamiento del conjunto',
        'Estate topology': 'Topología del conjunto',
        'Used in': 'Usada en',
        'Via': 'Vía',
        'Reaches': 'Alcanza',
        '(not in this binder)': '(no está en este binder)',
        'No site names another site.': 'Ningún sitio nombra a otro sitio.',
        'This network could not be read.': 'No se pudo leer esta red.',
        'A highlighted network is documented in more than one site. Whether that is a conflict depends on whether those sites are routed together, which this survey does not record — it is stated here as a fact, not as a finding.':
            'Una red resaltada está documentada en más de un sitio. Que eso sea un conflicto depende de si esos sitios están enrutados entre sí, algo que este levantamiento no registra: se indica como un hecho, no como un hallazgo.',
        '+{n} more': '+{n} más',
        'Nothing to report on yet — save a network first.':
            'Todavía no hay nada que informar: guarda una red primero.',
        // ---- Binder links & the guest shelf ----
        'Nothing was kept — you already have a newer copy of {n} of these.': 'No se conservó nada: ya tienes una copia más reciente de {n} de estas.',
        'Shared with you': 'Compartido contigo',
        '🔗 Copy binder link': '🔗 Copiar enlace del binder',
        'Copy binder link': 'Copiar enlace del binder',
        '⤓ Keep all in this browser': '⤓ Conservar todo en este navegador',
        'Keep': 'Conservar',
        'Keep in this browser': 'Conservar en este navegador',
        'Dismiss': 'Descartar',
        '{n} network was shared with you — it stays in this tab only until you keep it.':
            '{n} red fue compartida contigo: permanece solo en esta pestaña hasta que la conserves.',
        '{n} networks were shared with you — they stay in this tab only until you keep them.':
            '{n} redes fueron compartidas contigo: permanecen solo en esta pestaña hasta que las conserves.',
        'That binder link could not be read.': 'No se pudo leer ese enlace de binder.',
        'That binder link carried no networks.': 'Ese enlace de binder no traía ninguna red.',
        'Nothing to share yet.': 'Todavía no hay nada que compartir.',
        'This browser cannot make a binder link. Export the binder file instead?':
            'Este navegador no puede crear un enlace de binder. ¿Exportar el archivo del binder?',
        'These {n} networks are too much for one link. Export the binder file instead?':
            'Estas {n} redes son demasiado para un solo enlace. ¿Exportar el archivo del binder?',
        'Binder link copied — {n} networks in one URL. Anyone with the link can open them.':
            'Enlace del binder copiado: {n} redes en una sola URL. Cualquiera con el enlace puede abrirlas.',
        'Copy this binder link:': 'Copia este enlace del binder:',
        // ---- Save to binder (File System Access) ----
        'Saves to {name}': 'Se guarda en {name}',
        'change': 'cambiar',
        'That file already holds {n} networks you do not have. Add them to this browser?': 'Ese archivo ya contiene {n} redes que no tienes. ¿Agregarlas a este navegador?',
        // Landing & library — the front door on a bare URL, and the cards
        // for the networks this browser holds. See js/library.js.
        'build file, or a whole binder, here.': 'archivo de compilación, o un binder completo, aquí.',
        '⤓ Export binder': '⤓ Exportar binder',
        'Nothing to export yet.': 'Todavía no hay nada que exportar.',
        'Not exported yet — a build file is the only copy that survives a cleared cache.':
            'Aún sin exportar: un archivo es la única copia que sobrevive a un borrado de caché.',
        'Binder exported {when}.': 'Binder exportado {when}.',
        'Binder exported {when} — {n} network has changed since.':
            'Binder exportado {when} — {n} red ha cambiado desde entonces.',
        'Binder exported {when} — {n} networks have changed since.':
            'Binder exportado {when} — {n} redes han cambiado desde entonces.',
        'Binder loaded: {added} added, {updated} updated, {kept} already up to date.':
            'Binder cargado: {added} agregadas, {updated} actualizadas, {kept} ya al día.',
        '{n} entry in the file could not be read and was skipped.':
            '{n} entrada del archivo no se pudo leer y se omitió.',
        'That file does not look like a Topo build or binder.':
            'Ese archivo no parece una compilación ni un binder de Topo.',
        'That file is not valid JSON.': 'Ese archivo no es JSON válido.',
        'Could not read that file.': 'No se pudo leer ese archivo.',
        'Saved networks live in this browser only — this is not an account, and clearing site data removes them. Export the binder for a copy that survives.':
            'Las redes guardadas viven solo en este navegador: esto no es una cuenta, y borrar los datos del sitio las elimina. Exporta el binder para conservar una copia.',
        'Nobody ever wrote this network down.': 'Nadie dejó esta red por escrito.',
        'Draw it once, and it checks itself.': 'Dibújala una vez y se revisa sola.',
        'Every device, every subnet, every cable — with the address conflicts, loops and dead gateways found for you, and a report you can hand over.':
            'Cada equipo, cada subred, cada cable — con los conflictos de direcciones, los bucles y las puertas de enlace muertas encontrados por ti, y un informe que puedes entregar.',
        'It runs in this tab — no server, no upload, no account — which is why it still works in a comms room with no signal.':
            'Funciona en esta pestaña — sin servidor, sin subidas, sin cuenta — y por eso sigue funcionando en un site sin señal.',
        'A blank canvas that has its own link from the first device.':
            'Un lienzo en blanco que tiene su propio enlace desde el primer dispositivo.',
        'Or drop a': 'O suelta aquí un archivo',
        '✚ New network': '✚ Red nueva',
        '📂 Open a file': '📂 Abrir un archivo',
        'First time here? Start from something that already exists.':
            '¿Primera vez? Empieza desde algo que ya existe.',
        'Networks you save are kept in this browser, and show up here.':
            'Las redes que guardes se conservan en este navegador y aparecen aquí.',
        'Start a new network': 'Empezar una red nueva',
        'Open a file': 'Abrir un archivo',
        'Set up from a count': 'Configurar por conteo',
        'Open the example': 'Abrir el ejemplo',
        'Your networks': 'Tus redes',
        'Open this network': 'Abrir esta red',
        'No findings': 'Sin hallazgos',
        'Could not read': 'No se pudo leer',
        'Rename': 'Renombrar',
        'Delete': 'Eliminar',
        'Rename network — new name:': 'Renombrar red — nuevo nombre:',
        'Delete saved network "{name}"? This cannot be undone.':
            '¿Eliminar la red guardada «{name}»? Esto no se puede deshacer.',
        'Replace the network on screen with "{name}"?': '¿Reemplazar la red en pantalla por «{name}»?',
        'Name this network:': 'Nombra esta red:',
        'Saved "{name}" to your networks.': 'Se guardó «{name}» en tus redes.',
        'Nothing to save — add some devices first.':
            'No hay nada que guardar: agrega algunos dispositivos primero.',
        'Could not save — browser storage is unavailable (private mode or full).':
            'No se pudo guardar: el almacenamiento del navegador no está disponible (modo privado o lleno).',
        'Untitled network': 'Red sin título',
        'My networks': 'Mis redes',
        'saved here': 'guardadas aquí',
        'Save this network': 'Guardar esta red',
        'Save as template': 'Guardar como plantilla',
        'reusable': 'reutilizable',
        'just now': 'ahora mismo',
        '{n}m ago': 'hace {n} min',
        '{n}h ago': 'hace {n} h',
        '{n}d ago': 'hace {n} d',
        '{n} device': '{n} dispositivo',
        '{n} devices': '{n} dispositivos',
        '{n} subnet': '{n} subred',
        '{n} subnets': '{n} subredes',
    },
    'pt-BR': {
        // Interfaces
        'No interfaces assigned. This node is acting as an L2 backplane.': 'Nenhuma interface atribuída. Este nó funciona como backplane L2.',
        'No interfaces configured.': 'Nenhuma interface configurada.',
        'Invalid CIDR on: {names}': 'CIDR inválido em: {names}',
        'Interfaces exist, but none has a valid CIDR IP.': 'Existem interfaces, mas nenhuma tem um IP CIDR válido.',
        '{n} valid interface configured.': '{n} interface válida configurada.',
        '{n} valid interfaces configured.': '{n} interfaces válidas configuradas.',
        // Multi-homing
        'L2 backplane nodes do not hold IPs to duplicate.': 'Nós de backplane L2 não têm IPs para duplicar.',
        'Each interface sits on its own subnet.': 'Cada interface está na sua própria sub-rede.',
        'MAC flapping: {names} both sit on {net} in the same broadcast domain. The switch sees this MAC on two ports and rewrites its CAM table, so new outbound ARP gets dropped while existing TCP sessions survive. Fix: unplug one, set arp_ignore=1 / arp_announce=2, or bond the NICs.':
            'Oscilação de MAC: {names} estão ambas em {net} no mesmo domínio de broadcast. O switch vê este MAC em duas portas e reescreve a tabela CAM, então o ARP novo de saída é descartado enquanto as sessões TCP existentes sobrevivem. Correção: desconecte uma, defina arp_ignore=1 / arp_announce=2, ou agregue as NICs em um bond.',
        'ARP flux: {names} share subnet {net}. The kernel answers ARP for these IPs on both NICs (weak host model). They reach different broadcast domains, so switches will not flap — but set arp_ignore=1 / arp_announce=2 to bind ARP to its own interface.':
            'Fluxo ARP: {names} compartilham a sub-rede {net}. O kernel responde ARP por esses IPs nas duas NICs (modelo de host fraco). Elas alcançam domínios de broadcast diferentes, então os switches não vão oscilar — mas defina arp_ignore=1 / arp_announce=2 para prender o ARP à própria interface.',
        // Ports
        'No links attached.': 'Nenhum enlace conectado.',
        '{n} link(s) are not bound to an interface. Select the link and pick a port.': '{n} enlace(s) não estão vinculados a uma interface. Selecione o enlace e escolha uma porta.',
        'Two cables on one port: {names}. A physical port carries one link.': 'Dois cabos em uma porta: {names}. Uma porta física carrega um único enlace.',
        '{n} link(s) land on interfaces this node no longer has. Rebind them or raise the port count.': '{n} enlace(s) terminam em interfaces que este nó não tem mais. Revincule-os ou aumente o número de portas.',
        '{used} cables on a {total}-port {type}. Raise the port count or add a switch.': '{used} cabos em um {type} de {total} portas. Aumente o número de portas ou adicione um switch.',
        '{used} of {total} ports in use.': '{used} de {total} portas em uso.',
        '{used} of {total} ports in use, {n} wireless client.': '{used} de {total} portas em uso, {n} cliente sem fio.',
        '{used} of {total} ports in use, {n} wireless clients.': '{used} de {total} portas em uso, {n} clientes sem fio.',
        '{n} link(s) on distinct interfaces.': '{n} enlace(s) em interfaces distintas.',
        // Radio
        '{iface} is wired but carries the Wi-Fi link to {peer}': '{iface} é cabeada mas carrega o enlace Wi-Fi até {peer}',
        '{iface} is a radio but carries the {medium} cable to {peer}': '{iface} é um rádio mas carrega o cabo {medium} até {peer}',
        '{problems}. Wi-Fi needs a wireless NIC (wlan0, wlp1s0); cables need an Ethernet port.': '{problems}. O Wi-Fi precisa de uma NIC sem fio (wlan0, wlp1s0); cabos precisam de uma porta Ethernet.',
        'Links match their interface type.': 'Os enlaces correspondem ao tipo da sua interface.',
        'Links match their interface type ({n} radio).': 'Os enlaces correspondem ao tipo da sua interface ({n} rádio).',
        'Links match their interface type ({n} radios).': 'Os enlaces correspondem ao tipo da sua interface ({n} rádios).',
        // Bonding
        'No bonded interfaces.': 'Nenhuma interface agregada.',
        '{bond} lists {n} member interface that no longer exists. Remove it from the bond, or recreate the NIC.': '{bond} declara {n} interface membro que não existe mais. Remova-a do bond ou recrie a NIC.',
        '{bond} lists {n} member interfaces that no longer exist. Remove them from the bond, or recreate the NICs.': '{bond} declara {n} interfaces membro que não existem mais. Remova-as do bond ou recrie as NICs.',
        '{bond} has {n} member. A bond of one is a NIC with extra steps — it buys no redundancy and no bandwidth. Add a second member or unbond it.':
            '{bond} tem {n} membro. Um bond de um só é uma NIC com passos a mais — não traz redundância nem banda. Adicione um segundo membro ou desfaça o bond.',
        '{names} still hold an address inside {bond}. Members are L2 only — the address belongs on the bond. Leave it on the members and the kernel answers ARP on each of them, which is the flux the bond was supposed to fix.':
            '{names} ainda têm um endereço dentro de {bond}. Os membros são apenas L2 — o endereço pertence ao bond. Deixe-o nos membros e o kernel responde ARP em cada um deles, que é justamente o fluxo que o bond deveria corrigir.',
        '{names} is a radio. A Wi-Fi association cannot be a bond member — the two ends negotiate a single association, not a trunk.':
            '{names} é um rádio. Uma associação Wi-Fi não pode ser membro de um bond — as duas pontas negociam uma única associação, não um tronco.',
        'LACP: {bond} members land in different broadcast domains. 802.3ad negotiates a LAG with one switch — split across two independent switches, the peers never bring the aggregate up. Use active-backup, or stack/MLAG the switches so they present as one.':
            'LACP: os membros de {bond} caem em domínios de broadcast diferentes. O 802.3ad negocia um LAG com um único switch — dividido entre dois switches independentes, as pontas nunca sobem a agregação. Use active-backup, ou empilhe os switches (stack/MLAG) para que se apresentem como um só.',
        '{bond} bonds {n} NICs ({mode}). One MAC, one address — no ARP flux to answer for.': '{bond} agrega {n} NICs ({mode}). Um MAC, um endereço — sem fluxo ARP a justificar.',
        // Hardware addresses
        'No hardware addresses recorded on this node.': 'Nenhum endereço físico registrado neste nó.',
        '{names} carries a broadcast or multicast address. An interface cannot source frames from a group address — that value belongs in a destination, not on a NIC.':
            '{names} tem um endereço de broadcast ou multicast. Uma interface não pode originar quadros a partir de um endereço de grupo — esse valor pertence a um destino, não a uma NIC.',
        '{mac} is on {where}. Two interfaces in one broadcast domain cannot hold the same address — the switch rewrites its CAM table on every frame, which is the flapping this tool reports from the other direction. Clone, restored backup or a hand-typed address are the usual causes.':
            '{mac} está em {where}. Duas interfaces em um mesmo domínio de broadcast não podem ter o mesmo endereço — o switch reescreve a tabela CAM a cada quadro, que é a oscilação que esta ferramenta relata pelo outro lado. Clone, backup restaurado ou endereço digitado à mão são as causas usuais.',
        'Every address here is locally administered ({names}). That is correct for a VM, a bond or a randomising client, and wrong for an inventory — the vendor prefix on these is made up.':
            'Todos os endereços aqui são de administração local ({names}). Isso está certo para uma VM, um bond ou um cliente que aleatoriza, e errado para um inventário — o prefixo de fabricante destes é inventado.',
        '{names} is locally administered — randomised or hand-set, so the vendor prefix says nothing.': '{names} é de administração local — aleatório ou definido à mão, então o prefixo de fabricante não diz nada.',
        '{names} are locally administered — randomised or hand-set, so the vendor prefix says nothing.': '{names} são de administração local — aleatórios ou definidos à mão, então o prefixo de fabricante não diz nada.',
        '{n} burned-in address, no duplicates on the map.': '{n} endereço gravado de fábrica, sem duplicatas no mapa.',
        '{n} burned-in addresses, no duplicates on the map.': '{n} endereços gravados de fábrica, sem duplicatas no mapa.',
        '{n} burned-in address, no duplicates on the map ({vendors}).': '{n} endereço gravado de fábrica, sem duplicatas no mapa ({vendors}).',
        '{n} burned-in addresses, no duplicates on the map ({vendors}).': '{n} endereços gravados de fábrica, sem duplicatas no mapa ({vendors}).',
        // Gateway
        'L2 backplane nodes do not require a gateway.': 'Nós de backplane L2 não precisam de gateway.',
        'No gateway configured.': 'Nenhum gateway configurado.',
        'Default route placeholder configured; cloud/internet node is reachable.': 'Marcador de rota padrão configurado; o nó de nuvem/internet está acessível.',
        'Default route placeholder configured.': 'Marcador de rota padrão configurado.',
        'Invalid gateway IP: {gw}': 'IP de gateway inválido: {gw}',
        'Gateway {gw} was not found on any node/interface.': 'O gateway {gw} não foi encontrado em nenhum nó ou interface.',
        'Gateway {gw} found on {node} and is reachable.': 'Gateway {gw} encontrado em {node} e acessível.',
        'Gateway {gw} exists on {node}, but is not reachable from this node.': 'O gateway {gw} existe em {node}, mas não é acessível a partir deste nó.',
        // DNS
        'L2 backplane nodes do not require DNS.': 'Nós de backplane L2 não precisam de DNS.',
        'No DNS server configured.': 'Nenhum servidor DNS configurado.',
        '{ip}: invalid DNS IP.': '{ip}: IP de DNS inválido.',
        '{ip}: found on {node}, reachable, DNS port OK.': '{ip}: encontrado em {node}, acessível, porta DNS OK.',
        '{ip}: found on {node}, but not reachable.': '{ip}: encontrado em {node}, mas não acessível.',
        '{ip}: reachable, but DNS port 53 appears closed.': '{ip}: acessível, mas a porta DNS 53 parece fechada.',
        '{ip}: private DNS server not found in topology.': '{ip}: servidor DNS privado não encontrado na topologia.',
        '{ip}: public DNS; cloud/internet path appears reachable.': '{ip}: DNS público; o caminho para nuvem/internet parece acessível.',
        '{ip}: public DNS, but no cloud/internet path was found.': '{ip}: DNS público, mas nenhum caminho para nuvem/internet foi encontrado.',
        // Trace port
        'Port filter off — trace is evaluating IP reachability only (port {port} ignored).': 'Filtro de porta desligado — o traço avalia apenas alcançabilidade IP (porta {port} ignorada).',
        'No trace port entered. Trace is evaluating IP reachability only.': 'Nenhuma porta de traço informada. O traço avalia apenas alcançabilidade IP.',
        'No trace port requested.': 'Nenhuma porta de traço solicitada.',
        'Invalid trace port: {port}': 'Porta de traço inválida: {port}',
        'Transit device; service port is not evaluated as an endpoint.': 'Dispositivo de trânsito; a porta de serviço não é avaliada como extremidade.',
        'No allowed ports defined; treating as open.': 'Nenhuma porta permitida definida; tratando como aberta.',
        'Allowed Ports field is invalid: {ports}': 'O campo de portas permitidas é inválido: {ports}',
        'Port {port} is allowed by this node.': 'A porta {port} é permitida por este nó.',
        "Port {port} is not listed in this node's Allowed Ports.": 'A porta {port} não consta nas portas permitidas deste nó.',
        // Topology-wide
        'Gateway {gw} is unreachable.': 'O gateway {gw} não é acessível.',
        'Invalid gateway format.': 'Formato de gateway inválido.',
        '{ip} shared by {names}.': '{ip} compartilhado por {names}.',
        '{a} ({ifaceA}) and {b} ({ifaceB}) are cabled together but sit on different subnets ({netA} vs {netB}).': '{a} ({ifaceA}) e {b} ({ifaceB}) estão cabeados entre si mas em sub-redes diferentes ({netA} vs {netB}).',
        'the link between {a} and {b} closes a switching loop. Broadcast storm risk unless STP is enabled.': 'o enlace entre {a} e {b} fecha um laço de comutação. Risco de tempestade de broadcast a menos que o STP esteja habilitado.',
        // Check names
        'Interfaces': 'Interfaces',
        'Multi-Homing': 'Multi-conexão',
        'Bond': 'Bond',
        'Ports': 'Portas',
        'Radio': 'Rádio',
        'MAC': 'MAC',
        'Gateway': 'Gateway',
        'DNS': 'DNS',
        'Trace Port': 'Porta de traço',
        'Cabling': 'Cabeamento',
        'IP Conflict': 'Conflito de IP',
        'L2 loop': 'Laço L2',
        // ---- Site report ----
        'Custom Node': 'Nó personalizado',
        'Site report': 'Relatório do site',
        'printable': 'imprimível',
        'The findings, the inventory and the diagram as one printable document. Everything here is optional — it only fills in the header.':
            'Os achados, o inventário e o diagrama em um único documento imprimível. Tudo aqui é opcional: preenche apenas o cabeçalho.',
        'Cancel': 'Cancelar',
        '📋 Open report': '📋 Abrir relatório',
        'Site': 'Site',
        'Client': 'Cliente',
        'Prepared by': 'Elaborado por',
        'Reference': 'Referência',
        'Date': 'Data',
        'Scope & notes': 'Escopo e notas',
        'What was surveyed, what was not, and anything the reader needs to know.':
            'O que foi levantado, o que não foi, e o que mais o leitor precisa saber.',
        'Network documentation report': 'Relatório de documentação de rede',
        'Site not named': 'Site sem nome',
        'Print / Save as PDF': 'Imprimir / Salvar como PDF',
        'Summary': 'Resumo',
        'Devices': 'Dispositivos',
        'Connections': 'Conexões',
        'Subnets': 'Sub-redes',
        'Critical': 'Crítico',
        'Advisory': 'Aviso',
        'Findings': 'Achados',
        'Severity': 'Severidade',
        'Device': 'Dispositivo',
        'Check': 'Verificação',
        'Finding': 'Achado',
        'No faults were raised by the documented configuration.': 'A configuração documentada não gerou nenhuma falha.',
        'Every automated check passed against the topology as recorded. That is a statement about the drawing, not a clean bill of health for the network — see Scope and method.':
            'Todas as verificações automáticas passaram sobre a topologia tal como registrada. Isso é uma afirmação sobre o desenho, não um atestado de saúde da rede — veja Escopo e método.',
        'Topology': 'Topologia',
        'Network topology diagram': 'Diagrama de topologia de rede',
        'Device inventory': 'Inventário de dispositivos',
        'Type': 'Tipo',
        'OS / firmware': 'SO / firmware',
        'Allowed': 'Permitidas',
        'none recorded': 'nada registrado',
        'bond': 'agregação',
        'bond member': 'membro da agregação',
        'radio': 'rádio',
        'From': 'De',
        'To': 'Para',
        'Interface': 'Interface',
        'Medium': 'Meio',
        'No connections recorded.': 'Nenhuma conexão registrada.',
        'Addressing': 'Endereçamento',
        'Network': 'Rede',
        'Kind': 'Tipo',
        'Members': 'Membros',
        'Private': 'Privada',
        'Public / routable': 'Pública / roteável',
        'No addressing recorded.': 'Nenhum endereçamento registrado.',
        'Scope and method': 'Escopo e método',
        'This report describes the network as documented during the survey. Findings are derived from the recorded topology, addressing and interface configuration — no device was scanned, probed or logged into to produce them, and nothing here was measured against live traffic.':
            'Este relatório descreve a rede tal como foi documentada durante o levantamento. Os achados derivam da topologia, do endereçamento e da configuração de interfaces registrados: para produzi-los nenhum equipamento foi escaneado, sondado ou acessado, e nada aqui foi medido contra tráfego real.',
        'A finding therefore means the configuration as recorded would cause the described behaviour. Where the documentation is incomplete, the corresponding check is silent rather than passing.':
            'Portanto, um achado significa que a configuração registrada produziria o comportamento descrito. Onde a documentação está incompleta, a verificação correspondente se cala em vez de aprovar.',
        'Generated with Topo · topo.carino.systems': 'Gerado com Topo · topo.carino.systems',
        'UTP copper': 'Cobre UTP',
        'Fibre optic': 'Fibra óptica',
        'Wireless': 'Sem fio',
        'Powerline': 'Rede elétrica',
        'VPN tunnel': 'Túnel VPN',
        'Unspecified': 'Não especificado',
        // ---- Binder report (js/report.js, the estate document) ----
        '📋 Binder report': '📋 Relatório do binder',
        'Binder report': 'Relatório do binder',
        'Every saved network as one document: the estate totals, the findings across all sites, the addressing they share, then each network in full.':
            'Todas as redes salvas em um único documento: os totais do conjunto, os achados de todos os sites, o endereçamento que compartilham e depois cada rede por inteiro.',
        'Open binder report': 'Abrir relatório do binder',
        'Open report': 'Abrir relatório',
        'Include a diagram for each site': 'Incluir um diagrama de cada site',
        'Renders each network in turn — slower, and the file gets much larger.':
            'Desenha cada rede por vez: mais lento, e o arquivo fica bem maior.',
        'Estate documentation report': 'Relatório de documentação do conjunto',
        'Estate not named': 'Conjunto sem nome',
        'Sites': 'Sites',
        'Site': 'Site',
        'Findings across the estate': 'Achados em todo o conjunto',
        'Estate addressing': 'Endereçamento do conjunto',
        'Estate topology': 'Topologia do conjunto',
        'Used in': 'Usada em',
        'Via': 'Via',
        'Reaches': 'Alcança',
        '(not in this binder)': '(não está neste binder)',
        'No site names another site.': 'Nenhum site nomeia outro site.',
        'This network could not be read.': 'Não foi possível ler esta rede.',
        'A highlighted network is documented in more than one site. Whether that is a conflict depends on whether those sites are routed together, which this survey does not record — it is stated here as a fact, not as a finding.':
            'Uma rede destacada está documentada em mais de um site. Se isso é um conflito depende de os sites estarem roteados entre si, o que este levantamento não registra: está aqui como fato, não como achado.',
        '+{n} more': '+{n} mais',
        'Nothing to report on yet — save a network first.':
            'Ainda não há nada a relatar: salve uma rede primeiro.',
        // ---- Binder links & the guest shelf ----
        'Nothing was kept — you already have a newer copy of {n} of these.': 'Nada foi guardado: você já tem uma cópia mais recente de {n} destas.',
        'Shared with you': 'Compartilhado com você',
        '🔗 Copy binder link': '🔗 Copiar link do binder',
        'Copy binder link': 'Copiar link do binder',
        '⤓ Keep all in this browser': '⤓ Guardar tudo neste navegador',
        'Keep': 'Guardar',
        'Keep in this browser': 'Guardar neste navegador',
        'Dismiss': 'Dispensar',
        '{n} network was shared with you — it stays in this tab only until you keep it.':
            '{n} rede foi compartilhada com você: fica só nesta aba até você guardá-la.',
        '{n} networks were shared with you — they stay in this tab only until you keep them.':
            '{n} redes foram compartilhadas com você: ficam só nesta aba até você guardá-las.',
        'That binder link could not be read.': 'Não foi possível ler esse link de binder.',
        'That binder link carried no networks.': 'Esse link de binder não trazia nenhuma rede.',
        'Nothing to share yet.': 'Ainda não há nada para compartilhar.',
        'This browser cannot make a binder link. Export the binder file instead?':
            'Este navegador não consegue criar um link de binder. Exportar o arquivo do binder?',
        'These {n} networks are too much for one link. Export the binder file instead?':
            'Estas {n} redes são demais para um único link. Exportar o arquivo do binder?',
        'Binder link copied — {n} networks in one URL. Anyone with the link can open them.':
            'Link do binder copiado: {n} redes em uma URL. Qualquer pessoa com o link pode abri-las.',
        'Copy this binder link:': 'Copie este link do binder:',
        // ---- Save to binder (File System Access) ----
        'Saves to {name}': 'Salva em {name}',
        'change': 'alterar',
        'That file already holds {n} networks you do not have. Add them to this browser?': 'Esse arquivo já contém {n} redes que você não tem. Adicionar a este navegador?',
        // Landing & library — the front door on a bare URL, and the cards
        // for the networks this browser holds. See js/library.js.
        'build file, or a whole binder, here.': 'arquivo de build, ou um binder inteiro, aqui.',
        '⤓ Export binder': '⤓ Exportar binder',
        'Nothing to export yet.': 'Ainda não há nada para exportar.',
        'Not exported yet — a build file is the only copy that survives a cleared cache.':
            'Ainda não exportado — um arquivo é a única cópia que sobrevive a uma limpeza de cache.',
        'Binder exported {when}.': 'Binder exportado {when}.',
        'Binder exported {when} — {n} network has changed since.':
            'Binder exportado {when} — {n} rede mudou desde então.',
        'Binder exported {when} — {n} networks have changed since.':
            'Binder exportado {when} — {n} redes mudaram desde então.',
        'Binder loaded: {added} added, {updated} updated, {kept} already up to date.':
            'Binder carregado: {added} adicionadas, {updated} atualizadas, {kept} já em dia.',
        '{n} entry in the file could not be read and was skipped.':
            '{n} entrada do arquivo não pôde ser lida e foi ignorada.',
        'That file does not look like a Topo build or binder.':
            'Esse arquivo não parece um build nem um binder do Topo.',
        'That file is not valid JSON.': 'Esse arquivo não é JSON válido.',
        'Could not read that file.': 'Não foi possível ler esse arquivo.',
        'Saved networks live in this browser only — this is not an account, and clearing site data removes them. Export the binder for a copy that survives.':
            'As redes salvas ficam somente neste navegador — isto não é uma conta, e limpar os dados do site as remove. Exporte o binder para ter uma cópia que sobrevive.',
        'Nobody ever wrote this network down.': 'Ninguém deixou esta rede documentada.',
        'Draw it once, and it checks itself.': 'Desenhe uma vez e ela se verifica sozinha.',
        'Every device, every subnet, every cable — with the address conflicts, loops and dead gateways found for you, and a report you can hand over.':
            'Cada equipamento, cada sub-rede, cada cabo — com os conflitos de endereço, os loops e os gateways mortos encontrados para você, e um relatório que dá para entregar.',
        'It runs in this tab — no server, no upload, no account — which is why it still works in a comms room with no signal.':
            'Roda nesta aba — sem servidor, sem upload, sem conta — e é por isso que continua funcionando numa sala de equipamentos sem sinal.',
        'A blank canvas that has its own link from the first device.':
            'Uma tela em branco que já tem seu próprio link desde o primeiro dispositivo.',
        'Or drop a': 'Ou solte aqui um arquivo',
        '✚ New network': '✚ Rede nova',
        '📂 Open a file': '📂 Abrir um arquivo',
        'First time here? Start from something that already exists.':
            'Primeira vez? Comece a partir de algo que já existe.',
        'Networks you save are kept in this browser, and show up here.':
            'As redes que você salvar ficam neste navegador e aparecem aqui.',
        'Start a new network': 'Começar uma rede nova',
        'Open a file': 'Abrir um arquivo',
        'Set up from a count': 'Configurar por contagem',
        'Open the example': 'Abrir o exemplo',
        'Your networks': 'Suas redes',
        'Open this network': 'Abrir esta rede',
        'No findings': 'Sem achados',
        'Could not read': 'Não foi possível ler',
        'Rename': 'Renomear',
        'Delete': 'Excluir',
        'Rename network — new name:': 'Renomear rede — novo nome:',
        'Delete saved network "{name}"? This cannot be undone.':
            'Excluir a rede salva "{name}"? Isso não pode ser desfeito.',
        'Replace the network on screen with "{name}"?': 'Substituir a rede na tela por "{name}"?',
        'Name this network:': 'Dê um nome a esta rede:',
        'Saved "{name}" to your networks.': 'Rede "{name}" salva nas suas redes.',
        'Nothing to save — add some devices first.':
            'Nada a salvar — adicione alguns dispositivos primeiro.',
        'Could not save — browser storage is unavailable (private mode or full).':
            'Não foi possível salvar — o armazenamento do navegador está indisponível (modo privado ou cheio).',
        'Untitled network': 'Rede sem título',
        'My networks': 'Minhas redes',
        'saved here': 'salvas aqui',
        'Save this network': 'Salvar esta rede',
        'Save as template': 'Salvar como modelo',
        'reusable': 'reutilizável',
        'just now': 'agora mesmo',
        '{n}m ago': 'há {n} min',
        '{n}h ago': 'há {n} h',
        '{n}d ago': 'há {n} d',
        '{n} device': '{n} dispositivo',
        '{n} devices': '{n} dispositivos',
        '{n} subnet': '{n} sub-rede',
        '{n} subnets': '{n} sub-redes',
    },
    ru: {
        // Interfaces. Counts are written to read correctly with any numeral in
        // front of them — Russian has three plural forms and a two-key split
        // cannot express all of them, so these avoid the declension entirely.
        'No interfaces assigned. This node is acting as an L2 backplane.': 'Интерфейсы не назначены. Этот узел работает как коммутационная матрица L2.',
        'No interfaces configured.': 'Интерфейсы не настроены.',
        'Invalid CIDR on: {names}': 'Некорректный CIDR на: {names}',
        'Interfaces exist, but none has a valid CIDR IP.': 'Интерфейсы есть, но ни у одного нет корректного IP в формате CIDR.',
        '{n} valid interface configured.': 'Настроено корректных интерфейсов: {n}.',
        '{n} valid interfaces configured.': 'Настроено корректных интерфейсов: {n}.',
        // Multi-homing
        'L2 backplane nodes do not hold IPs to duplicate.': 'У узлов коммутационной матрицы L2 нет IP-адресов, которые можно продублировать.',
        'Each interface sits on its own subnet.': 'Каждый интерфейс находится в своей подсети.',
        'MAC flapping: {names} both sit on {net} in the same broadcast domain. The switch sees this MAC on two ports and rewrites its CAM table, so new outbound ARP gets dropped while existing TCP sessions survive. Fix: unplug one, set arp_ignore=1 / arp_announce=2, or bond the NICs.':
            'Мерцание MAC: {names} находятся в {net} в одном широковещательном домене. Коммутатор видит этот MAC на двух портах и переписывает таблицу CAM, поэтому новый исходящий ARP отбрасывается, а уже установленные TCP-сессии продолжают работать. Решение: отключите один, задайте arp_ignore=1 / arp_announce=2 или объедините сетевые карты в агрегат.',
        'ARP flux: {names} share subnet {net}. The kernel answers ARP for these IPs on both NICs (weak host model). They reach different broadcast domains, so switches will not flap — but set arp_ignore=1 / arp_announce=2 to bind ARP to its own interface.':
            'Разброс ARP: {names} используют общую подсеть {net}. Ядро отвечает на ARP для этих адресов на обеих картах (слабая модель узла). Они выходят в разные широковещательные домены, поэтому коммутаторы не будут мерцать, но задайте arp_ignore=1 / arp_announce=2, чтобы привязать ARP к своему интерфейсу.',
        // Ports
        'No links attached.': 'Связи не подключены.',
        '{n} link(s) are not bound to an interface. Select the link and pick a port.': 'Не привязано к интерфейсу связей: {n}. Выберите связь и укажите порт.',
        'Two cables on one port: {names}. A physical port carries one link.': 'Два кабеля в одном порту: {names}. Физический порт несёт одну связь.',
        '{n} link(s) land on interfaces this node no longer has. Rebind them or raise the port count.': 'Связей, ведущих на отсутствующие интерфейсы: {n}. Привяжите их заново или увеличьте число портов.',
        '{used} cables on a {total}-port {type}. Raise the port count or add a switch.': '{used} кабелей на устройстве {type} с {total} портами. Увеличьте число портов или добавьте коммутатор.',
        '{used} of {total} ports in use.': 'Занято портов: {used} из {total}.',
        '{used} of {total} ports in use, {n} wireless client.': 'Занято портов: {used} из {total}, беспроводных клиентов: {n}.',
        '{used} of {total} ports in use, {n} wireless clients.': 'Занято портов: {used} из {total}, беспроводных клиентов: {n}.',
        '{n} link(s) on distinct interfaces.': 'Связей на разных интерфейсах: {n}.',
        // Radio
        '{iface} is wired but carries the Wi-Fi link to {peer}': '{iface} — проводной интерфейс, но несёт Wi-Fi-связь до {peer}',
        '{iface} is a radio but carries the {medium} cable to {peer}': '{iface} — радиоинтерфейс, но несёт кабель {medium} до {peer}',
        '{problems}. Wi-Fi needs a wireless NIC (wlan0, wlp1s0); cables need an Ethernet port.': '{problems}. Для Wi-Fi нужна беспроводная карта (wlan0, wlp1s0); кабелю нужен порт Ethernet.',
        'Links match their interface type.': 'Связи соответствуют типу своих интерфейсов.',
        'Links match their interface type ({n} radio).': 'Связи соответствуют типу своих интерфейсов (радиоинтерфейсов: {n}).',
        'Links match their interface type ({n} radios).': 'Связи соответствуют типу своих интерфейсов (радиоинтерфейсов: {n}).',
        // Bonding
        'No bonded interfaces.': 'Агрегированных интерфейсов нет.',
        '{bond} lists {n} member interface that no longer exists. Remove it from the bond, or recreate the NIC.': 'В {bond} указан {n} интерфейс-участник, которого больше нет. Уберите его из агрегата или создайте карту заново.',
        '{bond} lists {n} member interfaces that no longer exist. Remove them from the bond, or recreate the NICs.': 'В {bond} указано интерфейсов-участников, которых больше нет: {n}. Уберите их из агрегата или создайте карты заново.',
        '{bond} has {n} member. A bond of one is a NIC with extra steps — it buys no redundancy and no bandwidth. Add a second member or unbond it.':
            'В {bond} участников: {n}. Агрегат из одного — это обычная сетевая карта с лишними шагами: он не даёт ни резервирования, ни полосы. Добавьте второго участника или разберите агрегат.',
        '{names} still hold an address inside {bond}. Members are L2 only — the address belongs on the bond. Leave it on the members and the kernel answers ARP on each of them, which is the flux the bond was supposed to fix.':
            'У {names} всё ещё есть адрес внутри {bond}. Участники работают только на L2 — адрес принадлежит агрегату. Если оставить его на участниках, ядро будет отвечать на ARP на каждом из них, а это именно тот разброс, который агрегат должен был устранить.',
        '{names} is a radio. A Wi-Fi association cannot be a bond member — the two ends negotiate a single association, not a trunk.':
            '{names} — радиоинтерфейс. Ассоциация Wi-Fi не может быть участником агрегата: обе стороны согласуют одну ассоциацию, а не транк.',
        'LACP: {bond} members land in different broadcast domains. 802.3ad negotiates a LAG with one switch — split across two independent switches, the peers never bring the aggregate up. Use active-backup, or stack/MLAG the switches so they present as one.':
            'LACP: участники {bond} попадают в разные широковещательные домены. 802.3ad согласует LAG с одним коммутатором; разделённые между двумя независимыми коммутаторами, стороны никогда не поднимут агрегат. Используйте active-backup или объедините коммутаторы (стек/MLAG), чтобы они выглядели как один.',
        '{bond} bonds {n} NICs ({mode}). One MAC, one address — no ARP flux to answer for.': '{bond} объединяет сетевых карт: {n} ({mode}). Один MAC, один адрес — отвечать за разброс ARP не придётся.',
        // Hardware addresses
        'No hardware addresses recorded on this node.': 'Аппаратные адреса на этом узле не записаны.',
        '{names} carries a broadcast or multicast address. An interface cannot source frames from a group address — that value belongs in a destination, not on a NIC.':
            'У {names} широковещательный или групповой адрес. Интерфейс не может отправлять кадры с группового адреса — такое значение место в получателе, а не на сетевой карте.',
        '{mac} is on {where}. Two interfaces in one broadcast domain cannot hold the same address — the switch rewrites its CAM table on every frame, which is the flapping this tool reports from the other direction. Clone, restored backup or a hand-typed address are the usual causes.':
            '{mac} присутствует на {where}. Два интерфейса в одном широковещательном домене не могут иметь одинаковый адрес: коммутатор переписывает таблицу CAM на каждом кадре, а это то же мерцание, о котором инструмент сообщает с другой стороны. Обычные причины — клон, восстановленная резервная копия или адрес, введённый вручную.',
        'Every address here is locally administered ({names}). That is correct for a VM, a bond or a randomising client, and wrong for an inventory — the vendor prefix on these is made up.':
            'Все адреса здесь заданы локально ({names}). Для виртуальной машины, агрегата или клиента со случайными адресами это правильно, а для инвентаризации — нет: префикс производителя у них выдуман.',
        '{names} is locally administered — randomised or hand-set, so the vendor prefix says nothing.': '{names} задан локально — случайный или введённый вручную, поэтому префикс производителя ничего не говорит.',
        '{names} are locally administered — randomised or hand-set, so the vendor prefix says nothing.': '{names} заданы локально — случайные или введённые вручную, поэтому префикс производителя ничего не говорит.',
        '{n} burned-in address, no duplicates on the map.': 'Заводских адресов: {n}, дубликатов на карте нет.',
        '{n} burned-in addresses, no duplicates on the map.': 'Заводских адресов: {n}, дубликатов на карте нет.',
        '{n} burned-in address, no duplicates on the map ({vendors}).': 'Заводских адресов: {n}, дубликатов на карте нет ({vendors}).',
        '{n} burned-in addresses, no duplicates on the map ({vendors}).': 'Заводских адресов: {n}, дубликатов на карте нет ({vendors}).',
        // Gateway
        'L2 backplane nodes do not require a gateway.': 'Узлам коммутационной матрицы L2 шлюз не нужен.',
        'No gateway configured.': 'Шлюз не настроен.',
        'Default route placeholder configured; cloud/internet node is reachable.': 'Задана заглушка маршрута по умолчанию; узел облака/интернета доступен.',
        'Default route placeholder configured.': 'Задана заглушка маршрута по умолчанию.',
        'Invalid gateway IP: {gw}': 'Некорректный IP шлюза: {gw}',
        'Gateway {gw} was not found on any node/interface.': 'Шлюз {gw} не найден ни на одном узле или интерфейсе.',
        'Gateway {gw} found on {node} and is reachable.': 'Шлюз {gw} найден на {node} и доступен.',
        'Gateway {gw} exists on {node}, but is not reachable from this node.': 'Шлюз {gw} есть на {node}, но недоступен с этого узла.',
        // DNS
        'L2 backplane nodes do not require DNS.': 'Узлам коммутационной матрицы L2 DNS не нужен.',
        'No DNS server configured.': 'DNS-сервер не настроен.',
        '{ip}: invalid DNS IP.': '{ip}: некорректный IP DNS.',
        '{ip}: found on {node}, reachable, DNS port OK.': '{ip}: найден на {node}, доступен, порт DNS в порядке.',
        '{ip}: found on {node}, but not reachable.': '{ip}: найден на {node}, но недоступен.',
        '{ip}: reachable, but DNS port 53 appears closed.': '{ip}: доступен, но порт DNS 53 выглядит закрытым.',
        '{ip}: private DNS server not found in topology.': '{ip}: частный DNS-сервер не найден в топологии.',
        '{ip}: public DNS; cloud/internet path appears reachable.': '{ip}: публичный DNS; путь к облаку/интернету выглядит доступным.',
        '{ip}: public DNS, but no cloud/internet path was found.': '{ip}: публичный DNS, но путь к облаку/интернету не найден.',
        // Trace port
        'Port filter off — trace is evaluating IP reachability only (port {port} ignored).': 'Фильтр порта выключен — трассировка оценивает только доступность по IP (порт {port} игнорируется).',
        'No trace port entered. Trace is evaluating IP reachability only.': 'Порт трассировки не указан. Трассировка оценивает только доступность по IP.',
        'No trace port requested.': 'Порт трассировки не запрошен.',
        'Invalid trace port: {port}': 'Некорректный порт трассировки: {port}',
        'Transit device; service port is not evaluated as an endpoint.': 'Транзитное устройство; служебный порт не проверяется как конечная точка.',
        'No allowed ports defined; treating as open.': 'Разрешённые порты не заданы; считается открытым.',
        'Allowed Ports field is invalid: {ports}': 'Поле разрешённых портов некорректно: {ports}',
        'Port {port} is allowed by this node.': 'Порт {port} разрешён на этом узле.',
        "Port {port} is not listed in this node's Allowed Ports.": 'Порт {port} не указан в списке разрешённых портов этого узла.',
        // Topology-wide
        'Gateway {gw} is unreachable.': 'Шлюз {gw} недоступен.',
        'Invalid gateway format.': 'Некорректный формат шлюза.',
        '{ip} shared by {names}.': '{ip} используется несколькими устройствами: {names}.',
        '{a} ({ifaceA}) and {b} ({ifaceB}) are cabled together but sit on different subnets ({netA} vs {netB}).': '{a} ({ifaceA}) и {b} ({ifaceB}) соединены кабелем, но находятся в разных подсетях ({netA} и {netB}).',
        'the link between {a} and {b} closes a switching loop. Broadcast storm risk unless STP is enabled.': 'связь между {a} и {b} замыкает коммутационную петлю. Есть риск широковещательного шторма, если не включён STP.',
        // Check names
        'Interfaces': 'Интерфейсы',
        'Multi-Homing': 'Многодомность',
        'Bond': 'Агрегат',
        'Ports': 'Порты',
        'Radio': 'Радио',
        'MAC': 'MAC',
        'Gateway': 'Шлюз',
        'DNS': 'DNS',
        'Trace Port': 'Порт трассировки',
        'Cabling': 'Кабельная схема',
        'IP Conflict': 'Конфликт IP',
        'L2 loop': 'Петля L2',
        // ---- Site report ----
        'Custom Node': 'Произвольный узел',
        'Site report': 'Отчёт по объекту',
        'printable': 'для печати',
        'The findings, the inventory and the diagram as one printable document. Everything here is optional — it only fills in the header.':
            'Выводы, инвентаризация и схема в одном документе для печати. Все поля необязательны — они заполняют только заголовок.',
        'Cancel': 'Отмена',
        '📋 Open report': '📋 Открыть отчёт',
        'Site': 'Объект',
        'Client': 'Заказчик',
        'Prepared by': 'Подготовил',
        'Reference': 'Номер документа',
        'Date': 'Дата',
        'Scope & notes': 'Объём работ и примечания',
        'What was surveyed, what was not, and anything the reader needs to know.':
            'Что было обследовано, что нет, и всё, что нужно знать читателю.',
        'Network documentation report': 'Отчёт о документировании сети',
        'Site not named': 'Объект не назван',
        'Print / Save as PDF': 'Печать / Сохранить в PDF',
        'Summary': 'Сводка',
        'Devices': 'Устройства',
        'Connections': 'Соединения',
        'Subnets': 'Подсети',
        'Critical': 'Критично',
        'Advisory': 'Предупреждение',
        'Findings': 'Выводы',
        'Severity': 'Уровень',
        'Device': 'Устройство',
        'Check': 'Проверка',
        'Finding': 'Вывод',
        'No faults were raised by the documented configuration.': 'Задокументированная конфигурация не выявила неисправностей.',
        'Every automated check passed against the topology as recorded. That is a statement about the drawing, not a clean bill of health for the network — see Scope and method.':
            'Все автоматические проверки пройдены по топологии в том виде, в каком она зафиксирована. Это утверждение о схеме, а не заключение о состоянии сети — см. раздел «Объём и метод».',
        'Topology': 'Топология',
        'Network topology diagram': 'Схема топологии сети',
        'Device inventory': 'Инвентаризация устройств',
        'Type': 'Тип',
        'OS / firmware': 'ОС / прошивка',
        'Allowed': 'Разрешены',
        'none recorded': 'не записано',
        'bond': 'агрегат',
        'bond member': 'участник агрегата',
        'radio': 'радио',
        'From': 'От',
        'To': 'К',
        'Interface': 'Интерфейс',
        'Medium': 'Среда',
        'No connections recorded.': 'Соединения не записаны.',
        'Addressing': 'Адресация',
        'Network': 'Сеть',
        'Kind': 'Тип',
        'Members': 'Участники',
        'Private': 'Частная',
        'Public / routable': 'Публичная / маршрутизируемая',
        'No addressing recorded.': 'Адресация не записана.',
        'Scope and method': 'Объём и метод',
        'This report describes the network as documented during the survey. Findings are derived from the recorded topology, addressing and interface configuration — no device was scanned, probed or logged into to produce them, and nothing here was measured against live traffic.':
            'Этот отчёт описывает сеть в том виде, в каком она была задокументирована при обследовании. Выводы получены из зафиксированной топологии, адресации и настроек интерфейсов: для их получения ни одно устройство не сканировалось, не опрашивалось и не использовалось для входа, и ничто здесь не измерялось на реальном трафике.',
        'A finding therefore means the configuration as recorded would cause the described behaviour. Where the documentation is incomplete, the corresponding check is silent rather than passing.':
            'Поэтому вывод означает, что зафиксированная конфигурация привела бы к описанному поведению. Там, где документация неполна, соответствующая проверка молчит, а не считается пройденной.',
        'Generated with Topo · topo.carino.systems': 'Создано в Topo · topo.carino.systems',
        'UTP copper': 'Медь UTP',
        'Fibre optic': 'Оптическое волокно',
        'Wireless': 'Беспроводная',
        'Powerline': 'По электросети',
        'VPN tunnel': 'Туннель VPN',
        'Unspecified': 'Не указано',
        // ---- Binder report (js/report.js, the estate document) ----
        '📋 Binder report': '📋 Отчёт по биндеру',
        'Binder report': 'Отчёт по биндеру',
        'Every saved network as one document: the estate totals, the findings across all sites, the addressing they share, then each network in full.':
            'Все сохранённые сети одним документом: сводка по объекту, замечания по всем площадкам, общая адресация, а затем каждая сеть целиком.',
        'Open binder report': 'Открыть отчёт по биндеру',
        'Open report': 'Открыть отчёт',
        'Include a diagram for each site': 'Включить схему каждой площадки',
        'Renders each network in turn — slower, and the file gets much larger.':
            'Отрисовывает каждую сеть по очереди: медленнее, и файл получается заметно больше.',
        'Estate documentation report': 'Отчёт о документировании объекта',
        'Estate not named': 'Объект без названия',
        'Sites': 'Площадки',
        'Site': 'Площадка',
        'Findings across the estate': 'Замечания по всему объекту',
        'Estate addressing': 'Адресация по объекту',
        'Estate topology': 'Топология объекта',
        'Used in': 'Используется в',
        'Via': 'Через',
        'Reaches': 'Достигает',
        '(not in this binder)': '(нет в этом биндере)',
        'No site names another site.': 'Ни одна площадка не ссылается на другую.',
        'This network could not be read.': 'Не удалось прочитать эту сеть.',
        'A highlighted network is documented in more than one site. Whether that is a conflict depends on whether those sites are routed together, which this survey does not record — it is stated here as a fact, not as a finding.':
            'Выделенная сеть задокументирована более чем на одной площадке. Конфликт это или нет, зависит от того, маршрутизируются ли эти площадки между собой, а обследование этого не фиксирует: здесь это указано как факт, а не как замечание.',
        '+{n} more': 'ещё {n}',
        'Nothing to report on yet — save a network first.':
            'Пока не о чем отчитываться — сначала сохраните сеть.',
        // ---- Binder links & the guest shelf ----
        'Nothing was kept — you already have a newer copy of {n} of these.': 'Ничего не сохранено: у вас уже есть более новая копия ({n}).',
        'Shared with you': 'Поделились с вами',
        '🔗 Copy binder link': '🔗 Скопировать ссылку на биндер',
        'Copy binder link': 'Скопировать ссылку на биндер',
        '⤓ Keep all in this browser': '⤓ Сохранить всё в этом браузере',
        'Keep': 'Сохранить',
        'Keep in this browser': 'Сохранить в этом браузере',
        'Dismiss': 'Отклонить',
        '{n} network was shared with you — it stays in this tab only until you keep it.':
            'С вами поделились сетями: {n}. Она останется только в этой вкладке, пока вы её не сохраните.',
        '{n} networks were shared with you — they stay in this tab only until you keep them.':
            'С вами поделились сетями: {n}. Они останутся только в этой вкладке, пока вы их не сохраните.',
        'That binder link could not be read.': 'Не удалось прочитать эту ссылку на биндер.',
        'That binder link carried no networks.': 'По этой ссылке на биндер не оказалось ни одной сети.',
        'Nothing to share yet.': 'Пока нечем поделиться.',
        'This browser cannot make a binder link. Export the binder file instead?':
            'Этот браузер не может создать ссылку на биндер. Экспортировать файл биндера?',
        'These {n} networks are too much for one link. Export the binder file instead?':
            'Столько сетей ({n}) не помещается в одну ссылку. Экспортировать файл биндера?',
        'Binder link copied — {n} networks in one URL. Anyone with the link can open them.':
            'Ссылка на биндер скопирована: сетей в одном URL — {n}. Открыть их сможет любой, у кого есть ссылка.',
        'Copy this binder link:': 'Скопируйте эту ссылку на биндер:',
        // ---- Save to binder (File System Access) ----
        'Saves to {name}': 'Сохраняется в {name}',
        'change': 'изменить',
        'That file already holds {n} networks you do not have. Add them to this browser?': 'В этом файле уже есть сети, которых у вас нет: {n}. Добавить их в этот браузер?',
        // Landing & library — the front door on a bare URL, and the cards
        // for the networks this browser holds. See js/library.js.
        'build file, or a whole binder, here.': 'файл сборки или целый биндер сюда.',
        '⤓ Export binder': '⤓ Экспорт биндера',
        'Nothing to export yet.': 'Пока нечего экспортировать.',
        'Not exported yet — a build file is the only copy that survives a cleared cache.':
            'Ещё не экспортировано — файл остаётся единственной копией, пережившей очистку кэша.',
        'Binder exported {when}.': 'Биндер экспортирован {when}.',
        'Binder exported {when} — {n} network has changed since.':
            'Биндер экспортирован {when} — с тех пор изменилась {n} сеть.',
        'Binder exported {when} — {n} networks have changed since.':
            'Биндер экспортирован {when} — с тех пор изменились сетей: {n}.',
        'Binder loaded: {added} added, {updated} updated, {kept} already up to date.':
            'Биндер загружен: добавлено {added}, обновлено {updated}, без изменений {kept}.',
        '{n} entry in the file could not be read and was skipped.':
            'Записей в файле не удалось прочитать и они пропущены: {n}.',
        'That file does not look like a Topo build or binder.':
            'Этот файл не похож ни на сборку, ни на биндер Topo.',
        'That file is not valid JSON.': 'Этот файл не является корректным JSON.',
        'Could not read that file.': 'Не удалось прочитать этот файл.',
        'Saved networks live in this browser only — this is not an account, and clearing site data removes them. Export the binder for a copy that survives.':
            'Сохранённые сети хранятся только в этом браузере — это не учётная запись, и очистка данных сайта их удалит. Экспортируйте биндер, чтобы копия сохранилась.',
        'Nobody ever wrote this network down.': 'Эту сеть никто так и не задокументировал.',
        'Draw it once, and it checks itself.': 'Нарисуйте её один раз — дальше она проверяет себя сама.',
        'Every device, every subnet, every cable — with the address conflicts, loops and dead gateways found for you, and a report you can hand over.':
            'Каждое устройство, каждая подсеть, каждый кабель — с найденными за вас конфликтами адресов, петлями и мёртвыми шлюзами, и отчётом, который можно отдать.',
        'It runs in this tab — no server, no upload, no account — which is why it still works in a comms room with no signal.':
            'Работает в этой вкладке — без сервера, без загрузки, без учётной записи — и поэтому продолжает работать в серверной без связи.',
        'A blank canvas that has its own link from the first device.':
            'Пустой холст, у которого есть своя ссылка с первого же устройства.',
        'Or drop a': 'Или перетащите сюда файл сборки',
        '✚ New network': '✚ Новая сеть',
        '📂 Open a file': '📂 Открыть файл',
        'First time here? Start from something that already exists.':
            'Впервые здесь? Начните с того, что уже есть.',
        'Networks you save are kept in this browser, and show up here.':
            'Сохранённые сети остаются в этом браузере и появляются здесь.',
        'Start a new network': 'Создать новую сеть',
        'Open a file': 'Открыть файл',
        'Set up from a count': 'Настроить по количеству',
        'Open the example': 'Открыть пример',
        'Your networks': 'Ваши сети',
        'Open this network': 'Открыть эту сеть',
        'No findings': 'Замечаний нет',
        'Could not read': 'Не удалось прочитать',
        'Rename': 'Переименовать',
        'Delete': 'Удалить',
        'Rename network — new name:': 'Переименовать сеть — новое имя:',
        'Delete saved network "{name}"? This cannot be undone.':
            'Удалить сохранённую сеть «{name}»? Это действие необратимо.',
        'Replace the network on screen with "{name}"?': 'Заменить сеть на экране на «{name}»?',
        'Name this network:': 'Назовите эту сеть:',
        'Saved "{name}" to your networks.': 'Сеть «{name}» сохранена в ваших сетях.',
        'Nothing to save — add some devices first.': 'Нечего сохранять — сначала добавьте устройства.',
        'Could not save — browser storage is unavailable (private mode or full).':
            'Не удалось сохранить — хранилище браузера недоступно (приватный режим или переполнено).',
        'Untitled network': 'Сеть без названия',
        'My networks': 'Мои сети',
        'saved here': 'сохранено здесь',
        'Save this network': 'Сохранить эту сеть',
        'Save as template': 'Сохранить как шаблон',
        'reusable': 'многоразовый',
        'just now': 'только что',
        '{n}m ago': '{n} мин назад',
        '{n}h ago': '{n} ч назад',
        '{n}d ago': '{n} дн назад',
        '{n} device': '{n} устройство',
        '{n} devices': '{n} устройств',
        '{n} subnet': '{n} подсеть',
        '{n} subnets': '{n} подсетей',
    },
    ja: {
        // Japanese marks no plural, so each singular/plural pair maps to one
        // form. The pairs are kept anyway: the key set has to match every other
        // locale or tests/suites/i18n.js fails, and that check is what keeps a
        // new message from shipping untranslated.
        'No interfaces assigned. This node is acting as an L2 backplane.': 'インターフェースが割り当てられていません。このノードは L2 バックプレーンとして動作しています。',
        'No interfaces configured.': 'インターフェースが設定されていません。',
        'Invalid CIDR on: {names}': 'CIDR が不正です: {names}',
        'Interfaces exist, but none has a valid CIDR IP.': 'インターフェースはありますが、有効な CIDR 形式の IP を持つものがありません。',
        '{n} valid interface configured.': '有効なインターフェース {n} 個が設定されています。',
        '{n} valid interfaces configured.': '有効なインターフェース {n} 個が設定されています。',
        // Multi-homing
        'L2 backplane nodes do not hold IPs to duplicate.': 'L2 バックプレーンのノードは重複しうる IP を持ちません。',
        'Each interface sits on its own subnet.': '各インターフェースはそれぞれ別のサブネットにあります。',
        'MAC flapping: {names} both sit on {net} in the same broadcast domain. The switch sees this MAC on two ports and rewrites its CAM table, so new outbound ARP gets dropped while existing TCP sessions survive. Fix: unplug one, set arp_ignore=1 / arp_announce=2, or bond the NICs.':
            'MAC フラッピング: {names} が同じブロードキャストドメイン内の {net} に両方とも存在します。スイッチはこの MAC を 2 つのポートで検出して CAM テーブルを書き換えるため、確立済みの TCP セッションは維持される一方で、新しい送信 ARP は破棄されます。対処: 片方を抜く、arp_ignore=1 / arp_announce=2 を設定する、または NIC をボンディングしてください。',
        'ARP flux: {names} share subnet {net}. The kernel answers ARP for these IPs on both NICs (weak host model). They reach different broadcast domains, so switches will not flap — but set arp_ignore=1 / arp_announce=2 to bind ARP to its own interface.':
            'ARP フラックス: {names} がサブネット {net} を共有しています。カーネルは（ウィークホストモデルにより）これらの IP に対して両方の NIC で ARP に応答します。到達するブロードキャストドメインが異なるためスイッチはフラッピングしませんが、ARP を自分のインターフェースに固定するため arp_ignore=1 / arp_announce=2 を設定してください。',
        // Ports
        'No links attached.': 'リンクが接続されていません。',
        '{n} link(s) are not bound to an interface. Select the link and pick a port.': '{n} 本のリンクがインターフェースに紐づいていません。リンクを選択してポートを指定してください。',
        'Two cables on one port: {names}. A physical port carries one link.': '1 つのポートに 2 本のケーブル: {names}。物理ポートが運べるリンクは 1 本です。',
        '{n} link(s) land on interfaces this node no longer has. Rebind them or raise the port count.': '{n} 本のリンクが、このノードにもう存在しないインターフェースに着地しています。紐づけ直すか、ポート数を増やしてください。',
        '{used} cables on a {total}-port {type}. Raise the port count or add a switch.': '{total} ポートの {type} に {used} 本のケーブルがあります。ポート数を増やすか、スイッチを追加してください。',
        '{used} of {total} ports in use.': '{total} ポート中 {used} ポート使用中。',
        '{used} of {total} ports in use, {n} wireless client.': '{total} ポート中 {used} ポート使用中、無線クライアント {n} 台。',
        '{used} of {total} ports in use, {n} wireless clients.': '{total} ポート中 {used} ポート使用中、無線クライアント {n} 台。',
        '{n} link(s) on distinct interfaces.': '{n} 本のリンクがそれぞれ別のインターフェースにあります。',
        // Radio
        '{iface} is wired but carries the Wi-Fi link to {peer}': '{iface} は有線ですが、{peer} への Wi-Fi リンクを運んでいます',
        '{iface} is a radio but carries the {medium} cable to {peer}': '{iface} は無線ですが、{peer} への {medium} ケーブルを運んでいます',
        '{problems}. Wi-Fi needs a wireless NIC (wlan0, wlp1s0); cables need an Ethernet port.': '{problems}。Wi-Fi には無線 NIC（wlan0、wlp1s0）が必要で、ケーブルには Ethernet ポートが必要です。',
        'Links match their interface type.': 'リンクはインターフェースの種類と一致しています。',
        'Links match their interface type ({n} radio).': 'リンクはインターフェースの種類と一致しています（無線 {n} 個）。',
        'Links match their interface type ({n} radios).': 'リンクはインターフェースの種類と一致しています（無線 {n} 個）。',
        // Bonding
        'No bonded interfaces.': 'ボンディングされたインターフェースはありません。',
        '{bond} lists {n} member interface that no longer exists. Remove it from the bond, or recreate the NIC.': '{bond} に、もう存在しないメンバーインターフェースが {n} 個登録されています。ボンドから外すか、NIC を作り直してください。',
        '{bond} lists {n} member interfaces that no longer exist. Remove them from the bond, or recreate the NICs.': '{bond} に、もう存在しないメンバーインターフェースが {n} 個登録されています。ボンドから外すか、NIC を作り直してください。',
        '{bond} has {n} member. A bond of one is a NIC with extra steps — it buys no redundancy and no bandwidth. Add a second member or unbond it.':
            '{bond} のメンバーは {n} 個です。メンバーが 1 つのボンドは手間が増えただけの NIC で、冗長性も帯域も得られません。2 つ目のメンバーを追加するか、ボンドを解除してください。',
        '{names} still hold an address inside {bond}. Members are L2 only — the address belongs on the bond. Leave it on the members and the kernel answers ARP on each of them, which is the flux the bond was supposed to fix.':
            '{names} が {bond} の内側でまだアドレスを保持しています。メンバーは L2 のみで、アドレスはボンド側に置くものです。メンバーに残したままだとカーネルがそれぞれで ARP に応答し、まさにボンドが解決するはずだったフラックスが起きます。',
        '{names} is a radio. A Wi-Fi association cannot be a bond member — the two ends negotiate a single association, not a trunk.':
            '{names} は無線です。Wi-Fi のアソシエーションはボンドのメンバーになれません。両端が確立するのは 1 本のアソシエーションであって、トランクではないためです。',
        'LACP: {bond} members land in different broadcast domains. 802.3ad negotiates a LAG with one switch — split across two independent switches, the peers never bring the aggregate up. Use active-backup, or stack/MLAG the switches so they present as one.':
            'LACP: {bond} のメンバーが異なるブロードキャストドメインに分かれています。802.3ad は 1 台のスイッチと LAG をネゴシエートするため、独立した 2 台に分けると両端はアグリゲートを上げられません。active-backup を使うか、スイッチをスタック / MLAG で 1 台に見せてください。',
        '{bond} bonds {n} NICs ({mode}). One MAC, one address — no ARP flux to answer for.': '{bond} は {n} 個の NIC をボンディングしています（{mode}）。MAC もアドレスも 1 つで、ARP フラックスの心配はありません。',
        // Hardware addresses
        'No hardware addresses recorded on this node.': 'このノードにハードウェアアドレスは記録されていません。',
        '{names} carries a broadcast or multicast address. An interface cannot source frames from a group address — that value belongs in a destination, not on a NIC.':
            '{names} にブロードキャストまたはマルチキャストアドレスが設定されています。インターフェースはグループアドレスを送信元としてフレームを出せません。その値は宛先に置くもので、NIC に置くものではありません。',
        '{mac} is on {where}. Two interfaces in one broadcast domain cannot hold the same address — the switch rewrites its CAM table on every frame, which is the flapping this tool reports from the other direction. Clone, restored backup or a hand-typed address are the usual causes.':
            '{mac} が {where} にあります。1 つのブロードキャストドメイン内の 2 つのインターフェースが同じアドレスを持つことはできません。スイッチはフレームごとに CAM テーブルを書き換えます。これは本ツールが逆方向から報告しているフラッピングと同じ現象です。よくある原因は、クローン、復元したバックアップ、手入力のアドレスです。',
        'Every address here is locally administered ({names}). That is correct for a VM, a bond or a randomising client, and wrong for an inventory — the vendor prefix on these is made up.':
            'ここのアドレスはすべてローカル管理です（{names}）。仮想マシン、ボンド、アドレスをランダム化するクライアントであれば正しく、資産台帳としては誤りです。これらのベンダープレフィックスは実在しません。',
        '{names} is locally administered — randomised or hand-set, so the vendor prefix says nothing.': '{names} はローカル管理です。ランダム化または手動設定のため、ベンダープレフィックスからは何も分かりません。',
        '{names} are locally administered — randomised or hand-set, so the vendor prefix says nothing.': '{names} はローカル管理です。ランダム化または手動設定のため、ベンダープレフィックスからは何も分かりません。',
        '{n} burned-in address, no duplicates on the map.': '工場出荷時アドレス {n} 個、マップ上に重複はありません。',
        '{n} burned-in addresses, no duplicates on the map.': '工場出荷時アドレス {n} 個、マップ上に重複はありません。',
        '{n} burned-in address, no duplicates on the map ({vendors}).': '工場出荷時アドレス {n} 個、マップ上に重複はありません（{vendors}）。',
        '{n} burned-in addresses, no duplicates on the map ({vendors}).': '工場出荷時アドレス {n} 個、マップ上に重複はありません（{vendors}）。',
        // Gateway
        'L2 backplane nodes do not require a gateway.': 'L2 バックプレーンのノードにゲートウェイは不要です。',
        'No gateway configured.': 'ゲートウェイが設定されていません。',
        'Default route placeholder configured; cloud/internet node is reachable.': 'デフォルトルートのプレースホルダーが設定されています。クラウド / インターネットのノードに到達できます。',
        'Default route placeholder configured.': 'デフォルトルートのプレースホルダーが設定されています。',
        'Invalid gateway IP: {gw}': 'ゲートウェイの IP が不正です: {gw}',
        'Gateway {gw} was not found on any node/interface.': 'ゲートウェイ {gw} は、どのノードやインターフェースにも見つかりませんでした。',
        'Gateway {gw} found on {node} and is reachable.': 'ゲートウェイ {gw} を {node} で発見、到達可能です。',
        'Gateway {gw} exists on {node}, but is not reachable from this node.': 'ゲートウェイ {gw} は {node} に存在しますが、このノードからは到達できません。',
        // DNS
        'L2 backplane nodes do not require DNS.': 'L2 バックプレーンのノードに DNS は不要です。',
        'No DNS server configured.': 'DNS サーバーが設定されていません。',
        '{ip}: invalid DNS IP.': '{ip}: DNS の IP が不正です。',
        '{ip}: found on {node}, reachable, DNS port OK.': '{ip}: {node} で発見、到達可能、DNS ポートも問題ありません。',
        '{ip}: found on {node}, but not reachable.': '{ip}: {node} で発見しましたが、到達できません。',
        '{ip}: reachable, but DNS port 53 appears closed.': '{ip}: 到達できますが、DNS ポート 53 が閉じているようです。',
        '{ip}: private DNS server not found in topology.': '{ip}: プライベート DNS サーバーがトポロジー内に見つかりません。',
        '{ip}: public DNS; cloud/internet path appears reachable.': '{ip}: パブリック DNS。クラウド / インターネットへの経路は到達可能に見えます。',
        '{ip}: public DNS, but no cloud/internet path was found.': '{ip}: パブリック DNS ですが、クラウド / インターネットへの経路が見つかりません。',
        // Trace port
        'Port filter off — trace is evaluating IP reachability only (port {port} ignored).': 'ポートフィルターはオフです。トレースは IP 到達性のみを評価します（ポート {port} は無視）。',
        'No trace port entered. Trace is evaluating IP reachability only.': 'トレースポートが未入力です。トレースは IP 到達性のみを評価します。',
        'No trace port requested.': 'トレースポートは要求されていません。',
        'Invalid trace port: {port}': 'トレースポートが不正です: {port}',
        'Transit device; service port is not evaluated as an endpoint.': '中継機器です。サービスポートはエンドポイントとして評価しません。',
        'No allowed ports defined; treating as open.': '許可ポートが未定義のため、開放として扱います。',
        'Allowed Ports field is invalid: {ports}': '許可ポートの項目が不正です: {ports}',
        'Port {port} is allowed by this node.': 'ポート {port} はこのノードで許可されています。',
        "Port {port} is not listed in this node's Allowed Ports.": 'ポート {port} はこのノードの許可ポートに含まれていません。',
        // Topology-wide
        'Gateway {gw} is unreachable.': 'ゲートウェイ {gw} に到達できません。',
        'Invalid gateway format.': 'ゲートウェイの形式が不正です。',
        '{ip} shared by {names}.': '{ip} が {names} で重複しています。',
        '{a} ({ifaceA}) and {b} ({ifaceB}) are cabled together but sit on different subnets ({netA} vs {netB}).': '{a}（{ifaceA}）と {b}（{ifaceB}）はケーブルで接続されていますが、別々のサブネットにあります（{netA} と {netB}）。',
        'the link between {a} and {b} closes a switching loop. Broadcast storm risk unless STP is enabled.': '{a} と {b} の間のリンクがスイッチングループを閉じています。STP が有効でなければブロードキャストストームの恐れがあります。',
        // Check names
        'Interfaces': 'インターフェース',
        'Multi-Homing': 'マルチホーミング',
        'Bond': 'ボンド',
        'Ports': 'ポート',
        'Radio': '無線',
        'MAC': 'MAC',
        'Gateway': 'ゲートウェイ',
        'DNS': 'DNS',
        'Trace Port': 'トレースポート',
        'Cabling': '配線',
        'IP Conflict': 'IP 競合',
        'L2 loop': 'L2 ループ',
        // ---- Site report ----
        'Custom Node': 'カスタムノード',
        'Site report': 'サイトレポート',
        'printable': '印刷用',
        'The findings, the inventory and the diagram as one printable document. Everything here is optional — it only fills in the header.':
            '所見・機器一覧・構成図を 1 つの印刷用ドキュメントにまとめます。ここの入力はすべて任意で、ヘッダーに反映されるだけです。',
        'Cancel': 'キャンセル',
        '📋 Open report': '📋 レポートを開く',
        'Site': 'サイト',
        'Client': '顧客',
        'Prepared by': '作成者',
        'Reference': '文書番号',
        'Date': '日付',
        'Scope & notes': '範囲と備考',
        'What was surveyed, what was not, and anything the reader needs to know.':
            '調査した範囲、調査していない範囲、そして読み手が知っておくべきことを記入してください。',
        'Network documentation report': 'ネットワーク文書化レポート',
        'Site not named': 'サイト名未設定',
        'Print / Save as PDF': '印刷 / PDF で保存',
        'Summary': '概要',
        'Devices': '機器',
        'Connections': '接続',
        'Subnets': 'サブネット',
        'Critical': '重大',
        'Advisory': '注意',
        'Findings': '所見',
        'Severity': '重大度',
        'Device': '機器',
        'Check': '検査項目',
        'Finding': '所見',
        'No faults were raised by the documented configuration.': '文書化された構成から不具合は検出されませんでした。',
        'Every automated check passed against the topology as recorded. That is a statement about the drawing, not a clean bill of health for the network — see Scope and method.':
            '記録されたとおりのトポロジーに対して、自動検査はすべて合格しました。これは図面についての記述であり、ネットワークの健全性を保証するものではありません。「範囲と方法」を参照してください。',
        'Topology': 'トポロジー',
        'Network topology diagram': 'ネットワークトポロジー図',
        'Device inventory': '機器一覧',
        'Type': '種別',
        'OS / firmware': 'OS / ファームウェア',
        'Allowed': '許可',
        'none recorded': '記録なし',
        'bond': 'ボンド',
        'bond member': 'ボンドのメンバー',
        'radio': '無線',
        'From': '始点',
        'To': '終点',
        'Interface': 'インターフェース',
        'Medium': '媒体',
        'No connections recorded.': '接続は記録されていません。',
        'Addressing': 'アドレス割り当て',
        'Network': 'ネットワーク',
        'Kind': '種別',
        'Members': '所属機器',
        'Private': 'プライベート',
        'Public / routable': 'パブリック / ルーティング可能',
        'No addressing recorded.': 'アドレス割り当ては記録されていません。',
        'Scope and method': '範囲と方法',
        'This report describes the network as documented during the survey. Findings are derived from the recorded topology, addressing and interface configuration — no device was scanned, probed or logged into to produce them, and nothing here was measured against live traffic.':
            '本レポートは、調査時に文書化されたとおりのネットワークを記述したものです。所見は記録されたトポロジー、アドレス割り当て、インターフェース設定から導かれています。作成にあたり機器のスキャン・プローブ・ログインは行っておらず、実トラフィックに対する測定も行っていません。',
        'A finding therefore means the configuration as recorded would cause the described behaviour. Where the documentation is incomplete, the corresponding check is silent rather than passing.':
            'したがって所見とは、記録されたとおりの構成であれば記述された挙動が起きる、という意味です。文書化が不完全な箇所では、該当する検査は合格ではなく沈黙します。',
        'Generated with Topo · topo.carino.systems': 'Topo で生成 · topo.carino.systems',
        'UTP copper': 'UTP 銅線',
        'Fibre optic': '光ファイバー',
        'Wireless': '無線',
        'Powerline': '電力線',
        'VPN tunnel': 'VPN トンネル',
        'Unspecified': '未指定',
        // ---- Binder report (js/report.js, the estate document) ----
        '📋 Binder report': '📋 バインダーレポート',
        'Binder report': 'バインダーレポート',
        'Every saved network as one document: the estate totals, the findings across all sites, the addressing they share, then each network in full.':
            '保存したすべてのネットワークを 1 つの文書に。全体の集計、全拠点の指摘、共有しているアドレス、そして各ネットワークの詳細が続きます。',
        'Open binder report': 'バインダーレポートを開く',
        'Open report': 'レポートを開く',
        'Include a diagram for each site': '各拠点の構成図を含める',
        'Renders each network in turn — slower, and the file gets much larger.':
            '各ネットワークを順に描画します。時間がかかり、ファイルもかなり大きくなります。',
        'Estate documentation report': '全体構成ドキュメント',
        'Estate not named': '全体名称なし',
        'Sites': '拠点',
        'Site': '拠点',
        'Findings across the estate': '全拠点の指摘',
        'Estate addressing': '全体のアドレス設計',
        'Estate topology': '全体のトポロジー',
        'Used in': '使用拠点',
        'Via': '経由',
        'Reaches': '接続先',
        '(not in this binder)': '（このバインダーにありません）',
        'No site names another site.': '他の拠点を参照している拠点はありません。',
        'This network could not be read.': 'このネットワークは読み込めませんでした。',
        'A highlighted network is documented in more than one site. Whether that is a conflict depends on whether those sites are routed together, which this survey does not record — it is stated here as a fact, not as a finding.':
            'ハイライトされたネットワークは複数の拠点で記録されています。それが競合かどうかは、その拠点同士がルーティングされているかによりますが、本調査はそれを記録していません。ここでは事実として示しており、指摘ではありません。',
        '+{n} more': '他 {n} 件',
        'Nothing to report on yet — save a network first.': '報告できるものがまだありません。まずネットワークを保存してください。',
        // ---- Binder links & the guest shelf ----
        'Nothing was kept — you already have a newer copy of {n} of these.': '保存しませんでした。{n} 件についてはすでに新しいコピーがあります。',
        'Shared with you': '共有されたもの',
        '🔗 Copy binder link': '🔗 バインダーのリンクをコピー',
        'Copy binder link': 'バインダーのリンクをコピー',
        '⤓ Keep all in this browser': '⤓ すべてこのブラウザに保存',
        'Keep': '保存',
        'Keep in this browser': 'このブラウザに保存',
        'Dismiss': '閉じる',
        '{n} network was shared with you — it stays in this tab only until you keep it.':
            '{n} 件のネットワークが共有されています。保存するまではこのタブにのみ残ります。',
        '{n} networks were shared with you — they stay in this tab only until you keep them.':
            '{n} 件のネットワークが共有されています。保存するまではこのタブにのみ残ります。',
        'That binder link could not be read.': 'このバインダーのリンクは読み込めませんでした。',
        'That binder link carried no networks.': 'このバインダーのリンクにはネットワークがありませんでした。',
        'Nothing to share yet.': 'まだ共有できるものがありません。',
        'This browser cannot make a binder link. Export the binder file instead?':
            'このブラウザではバインダーのリンクを作成できません。バインダーのファイルを書き出しますか？',
        'These {n} networks are too much for one link. Export the binder file instead?':
            'この {n} 件のネットワークは 1 つのリンクには多すぎます。バインダーのファイルを書き出しますか？',
        'Binder link copied — {n} networks in one URL. Anyone with the link can open them.':
            'バインダーのリンクをコピーしました。{n} 件のネットワークが 1 つの URL に入っています。リンクを知っている人は誰でも開けます。',
        'Copy this binder link:': 'このバインダーのリンクをコピー:',
        // ---- Save to binder (File System Access) ----
        'Saves to {name}': '保存先: {name}',
        'change': '変更',
        'That file already holds {n} networks you do not have. Add them to this browser?': 'このファイルには手元にない {n} 件のネットワークがあります。このブラウザに追加しますか？',
        // Landing & library — the front door on a bare URL, and the cards
        // for the networks this browser holds. See js/library.js.
        'build file, or a whole binder, here.': 'ビルドファイル、またはバインダーごとここにドロップ。',
        '⤓ Export binder': '⤓ バインダーを書き出す',
        'Nothing to export yet.': '書き出せるものがまだありません。',
        'Not exported yet — a build file is the only copy that survives a cleared cache.':
            'まだ書き出していません。キャッシュを消しても残るのはファイルだけです。',
        'Binder exported {when}.': 'バインダーの書き出し: {when}。',
        'Binder exported {when} — {n} network has changed since.':
            'バインダーの書き出し: {when}。以降 {n} 件のネットワークが変更されています。',
        'Binder exported {when} — {n} networks have changed since.':
            'バインダーの書き出し: {when}。以降 {n} 件のネットワークが変更されています。',
        'Binder loaded: {added} added, {updated} updated, {kept} already up to date.':
            'バインダーを読み込みました: 追加 {added} 件、更新 {updated} 件、変更なし {kept} 件。',
        '{n} entry in the file could not be read and was skipped.': 'ファイル内の {n} 件は読み込めなかったためスキップしました。',
        'That file does not look like a Topo build or binder.': 'このファイルは Topo のビルドにもバインダーにも見えません。',
        'That file is not valid JSON.': 'このファイルは正しい JSON ではありません。',
        'Could not read that file.': 'このファイルを読み込めませんでした。',
        'Saved networks live in this browser only — this is not an account, and clearing site data removes them. Export the binder for a copy that survives.':
            '保存したネットワークはこのブラウザ内にのみ存在します。アカウントではないため、サイトデータを消去すると失われます。残したい場合はバインダーを書き出してください。',
        'Nobody ever wrote this network down.': 'このネットワークは誰も記録してこなかった。',
        'Draw it once, and it checks itself.': '一度描けば、あとは自動で点検します。',
        'Every device, every subnet, every cable — with the address conflicts, loops and dead gateways found for you, and a report you can hand over.':
            'すべての機器、すべてのサブネット、すべてのケーブルを。アドレスの重複、ループ、応答しないゲートウェイは自動で検出し、そのまま渡せるレポートになります。',
        'It runs in this tab — no server, no upload, no account — which is why it still works in a comms room with no signal.':
            'このタブ内で動作します。サーバーもアップロードもアカウントも不要なので、電波の届かない機械室でも使えます。',
        'A blank canvas that has its own link from the first device.': '空のキャンバス。最初の機器から専用リンクを持ちます。',
        'Or drop a': 'または',
        '✚ New network': '✚ 新規ネットワーク',
        '📂 Open a file': '📂 ファイルを開く',
        'First time here? Start from something that already exists.': '初めてですか？ すでにあるものから始められます。',
        'Networks you save are kept in this browser, and show up here.': '保存したネットワークはこのブラウザに残り、ここに表示されます。',
        'Start a new network': '新しいネットワークを作成',
        'Open a file': 'ファイルを開く',
        'Set up from a count': '台数から作成',
        'Open the example': 'サンプルを開く',
        'Your networks': '保存したネットワーク',
        'Open this network': 'このネットワークを開く',
        'No findings': '指摘なし',
        'Could not read': '読み込めません',
        'Rename': '名前を変更',
        'Delete': '削除',
        'Rename network — new name:': 'ネットワークの名前を変更 — 新しい名前:',
        'Delete saved network "{name}"? This cannot be undone.': '保存したネットワーク「{name}」を削除しますか？元に戻せません。',
        'Replace the network on screen with "{name}"?': '画面のネットワークを「{name}」に置き換えますか？',
        'Name this network:': 'このネットワークの名前:',
        'Saved "{name}" to your networks.': '「{name}」を保存しました。',
        'Nothing to save — add some devices first.': '保存するものがありません — まず機器を追加してください。',
        'Could not save — browser storage is unavailable (private mode or full).':
            '保存できません — ブラウザのストレージが利用できません（プライベートモードまたは容量不足）。',
        'Untitled network': '名称未設定のネットワーク',
        'My networks': 'マイネットワーク',
        'saved here': 'ここに保存',
        'Save this network': 'このネットワークを保存',
        'Save as template': 'テンプレートとして保存',
        'reusable': '再利用可',
        'just now': 'たった今',
        '{n}m ago': '{n}分前',
        '{n}h ago': '{n}時間前',
        '{n}d ago': '{n}日前',
        '{n} device': '{n} 台',
        '{n} devices': '{n} 台',
        '{n} subnet': '{n} サブネット',
        '{n} subnets': '{n} サブネット',
    }
};

// One dictionary at lookup time — t() should not care which file a string came
// from. Chrome entries win on a collision, since those are the ones a designer
// tuned for a specific button.
Object.keys(MESSAGES).forEach((loc) => { I18N[loc] = Object.assign({}, MESSAGES[loc], I18N[loc]); });

let LOCALE = 'en';

// BCP-47-ish tag -> supported locale, or null when unsupported.
function resolveLocale(tag) {
    if (!tag) return null;
    const l = String(tag).toLowerCase();
    if (l.startsWith('es')) return 'es';
    if (l.startsWith('pt')) return 'pt-BR';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('ru')) return 'ru';
    if (l.startsWith('en')) return 'en';
    return null;
}

function setLocale(l) {
    LOCALE = (l === 'en' || I18N[l]) ? l : 'en';
    document.documentElement.lang = LOCALE;
}

// English strings stay the keys, so a missing translation degrades to correct
// English rather than to a symbol. Params fill {braces} AFTER the lookup, which
// is what lets a translation reorder them — Japanese puts the subnet before the
// verb, Russian declines around it — without the call site knowing.
function t(key, params) {
    const dict = I18N[LOCALE];
    const str = (dict && dict[key]) || key;
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
}

// Static markup: elements carrying data-i18n use their original English text
// as the key (captured on first pass so locale switches stay reversible).
function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        if (!el.dataset.i18nKey) el.dataset.i18nKey = el.textContent.trim();
        el.textContent = t(el.dataset.i18nKey);
    });
}

// ---- Published surface (js/app.js consumes these as bare globals) ----
window.t = t;
window.setLocale = setLocale;
window.resolveLocale = resolveLocale;
window.applyStaticI18n = applyStaticI18n;
// The message catalogue, for tests/suites/i18n.js only: every locale must carry
// the same keys with the same placeholders, and that is asserted, not trusted.
window.CarinoI18N = { MESSAGES, locales: Object.keys(MESSAGES), current: () => LOCALE };

// ---- Fleet language switcher bridge (carino-lang.js) ----
// Switch the dictionary, then hand off to the app's own re-render. The lang is
// passed through so app.js can persist it in its settings — the preference is
// app state, the dictionary is ours.
function switchTo(lang) {
    setLocale(lang);
    if (typeof window.applyLocale === 'function') window.applyLocale(lang);
}
window.addEventListener('carino:langchange', (e) => switchTo(e.detail.lang));
// carino-lang.js is deferred, so it resolves the fleet-wide choice after this
// file has already picked a locale from the URL / saved settings / navigator.
// Deferred scripts run before DOMContentLoaded, so by then it is available.
document.addEventListener('DOMContentLoaded', () => {
    if (window.CarinoLang && resolveLocale(CarinoLang.current) === CarinoLang.current
        && CarinoLang.current !== LOCALE) switchTo(CarinoLang.current);
});

})();
