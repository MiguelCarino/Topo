package mail

// Langs are the email languages, the same five as the app (js/i18n.js).
var Langs = []string{"en", "es", "pt-BR", "ja", "ru"}

// ValidLang reports whether lang is one of Langs.
func ValidLang(lang string) bool {
	for _, l := range Langs {
		if l == lang {
			return true
		}
	}
	return false
}

// locales holds every email string, keyed by language then key. Every key
// in "en" must exist in every other language (mail_test asserts it). Values
// use {placeholders}; the values put in them are plain text, escaped for the
// HTML part. No string carries network content: the only site detail an
// email can hold is the name, and only when its owner allowed it in clear
// (the *_named variants).
//
// Russian avoids past-tense verbs about a person (their gender is unknown)
// and number agreement (counts come after a colon).
var locales = map[string]map[string]string{
	"en": {
		"footer.notify": "You get these emails because of your Topo account. Change them under Account, Notifications.",
		"footer.plain":  "This email was sent by the Topo server at {url}.",
		"button.open":   "Open Topo",
		"action.open":   "Open Topo:",
		"role.owner":    "owner",
		"role.provider": "provider",
		"role.viewer":   "viewer",

		"signin.subject": "Your Topo sign-in code: {code}",
		"signin.body":    "Your code to sign in to Topo is {code}. It works for {minutes} minutes.",
		"signin.action":  "Or open this link in the same browser where you asked for the code:",
		"signin.button":  "Sign in",
		"signin.after":   "If you did not ask for this code, ignore this email. Nobody can sign in without it.",

		"invite.subject":       "You are invited to a site on Topo",
		"invite.subject_named": "You are invited to “{name}” on Topo",
		"invite.body":          "{inviter} invited you to see a network on Topo as {role}. Open the invitation and sign in with this address to accept it. The invitation lasts 14 days.",
		"invite.body_named":    "{inviter} invited you to see the network “{name}” on Topo as {role}. Open the invitation and sign in with this address to accept it. The invitation lasts 14 days.",
		"invite.action":        "Open the invitation:",
		"invite.button":        "Open the invitation",

		"welcome.subject": "You can now use Topo",
		"welcome.body":    "{inviter} gave you access to the Topo server at {url}. Sign in with this address.",

		"member-joined.subject":         "Someone is waiting for access",
		"member-joined.body":            "{email} accepted your invitation to one of your sites. Open Topo to give them access.",
		"member-joined.body_named":      "{email} accepted your invitation to “{name}”. Open Topo to give them access.",
		"member-joined.keys.body":       "{email} needs access again to one of your sites: their keys changed. Check their safety code before you give it.",
		"member-joined.keys.body_named": "{email} needs access again to “{name}”: their keys changed. Check their safety code before you give it.",

		"granted.subject":    "You can open your site on Topo",
		"granted.body":       "An owner gave you access to a site. Open Topo to see it.",
		"granted.body_named": "An owner gave you access to “{name}”. Open Topo to see it.",

		"incident-sent.subject":    "A problem was reported to you",
		"incident-sent.body":       "A client reported a problem on one of your sites. Open Topo to see it.",
		"incident-sent.body_named": "A client reported a problem on “{name}”. Open Topo to see it.",

		"visit-recorded.subject":    "A provider recorded a visit",
		"visit-recorded.body":       "A provider recorded a visit on one of your sites. Open Topo to see it.",
		"visit-recorded.body_named": "A provider recorded a visit on “{name}”. Open Topo to see it.",
		"visit-recorded.many":       "Visits recorded on one of your sites: {n}. Open Topo to see them.",
		"visit-recorded.many_named": "Visits recorded on “{name}”: {n}. Open Topo to see them.",

		"incident-closed.subject":    "A problem was closed",
		"incident-closed.body":       "A problem on one of your sites was marked fixed. Open Topo to see it.",
		"incident-closed.body_named": "A problem on “{name}” was marked fixed. Open Topo to see it.",

		"revision.subject":    "Changes on one of your sites",
		"revision.body":       "Changes saved on one of your sites since {time}: {n}. Open Topo to see them.",
		"revision.body_named": "Changes saved on “{name}” since {time}: {n}. Open Topo to see them.",

		"link-request.subject": "A new browser wants your Topo account",
		"link-request.body":    "A browser asked to open your Topo account. Approve it from a browser where you are signed in, or use your recovery key. If it was not you, ignore this email and remove that browser in your account.",

		"infra.link":     "Follow the infrastructure link",
		"infra.plain":    "Follow the infrastructure link: {link}",
		"report.subject": "A network problem was reported",
		"report.phone":   "Reporter's phone: {phone}",
		"report.pass":    "The passphrase comes separately: I will send it by another way.",
		"report.footer":  "This email was sent by the Topo server at {url} on behalf of {email}. Reply to write to them.",

		"test.subject": "Topo test email",
		"test.body":    "This is a test from your Topo server at {url}. Email works.",
	},
	"es": {
		"footer.notify": "Recibe estos correos por su cuenta de Topo. Puede cambiarlos en Cuenta, Notificaciones.",
		"footer.plain":  "Este correo lo envió el servidor de Topo en {url}.",
		"button.open":   "Abrir Topo",
		"action.open":   "Abrir Topo:",
		"role.owner":    "propietario",
		"role.provider": "proveedor",
		"role.viewer":   "lector",

		"signin.subject": "Su código para entrar en Topo: {code}",
		"signin.body":    "Su código para entrar en Topo es {code}. Vale durante {minutes} minutos.",
		"signin.action":  "O abra este enlace en el mismo navegador donde pidió el código:",
		"signin.button":  "Entrar",
		"signin.after":   "Si no pidió este código, ignore este correo. Nadie puede entrar sin él.",

		"invite.subject":       "Le invitaron a un sitio en Topo",
		"invite.subject_named": "Le invitaron a «{name}» en Topo",
		"invite.body":          "{inviter} le invitó a ver una red en Topo como {role}. Abra la invitación y entre con esta dirección para aceptarla. La invitación dura 14 días.",
		"invite.body_named":    "{inviter} le invitó a ver la red «{name}» en Topo como {role}. Abra la invitación y entre con esta dirección para aceptarla. La invitación dura 14 días.",
		"invite.action":        "Abrir la invitación:",
		"invite.button":        "Abrir la invitación",

		"welcome.subject": "Ya puede usar Topo",
		"welcome.body":    "{inviter} le dio acceso al servidor de Topo en {url}. Entre con esta dirección.",

		"member-joined.subject":         "Alguien espera acceso",
		"member-joined.body":            "{email} aceptó su invitación a uno de sus sitios. Abra Topo para darle acceso.",
		"member-joined.body_named":      "{email} aceptó su invitación a «{name}». Abra Topo para darle acceso.",
		"member-joined.keys.body":       "{email} necesita acceso de nuevo a uno de sus sitios: sus claves cambiaron. Compruebe su código de seguridad antes de dárselo.",
		"member-joined.keys.body_named": "{email} necesita acceso de nuevo a «{name}»: sus claves cambiaron. Compruebe su código de seguridad antes de dárselo.",

		"granted.subject":    "Ya puede abrir su sitio en Topo",
		"granted.body":       "Un propietario le dio acceso a un sitio. Abra Topo para verlo.",
		"granted.body_named": "Un propietario le dio acceso a «{name}». Abra Topo para verlo.",

		"incident-sent.subject":    "Le reportaron un problema",
		"incident-sent.body":       "Un cliente reportó un problema en uno de sus sitios. Abra Topo para verlo.",
		"incident-sent.body_named": "Un cliente reportó un problema en «{name}». Abra Topo para verlo.",

		"visit-recorded.subject":    "Un proveedor registró una visita",
		"visit-recorded.body":       "Un proveedor registró una visita en uno de sus sitios. Abra Topo para verla.",
		"visit-recorded.body_named": "Un proveedor registró una visita en «{name}». Abra Topo para verla.",
		"visit-recorded.many":       "Visitas registradas en uno de sus sitios: {n}. Abra Topo para verlas.",
		"visit-recorded.many_named": "Visitas registradas en «{name}»: {n}. Abra Topo para verlas.",

		"incident-closed.subject":    "Se cerró un problema",
		"incident-closed.body":       "Un problema en uno de sus sitios se marcó como resuelto. Abra Topo para verlo.",
		"incident-closed.body_named": "Un problema en «{name}» se marcó como resuelto. Abra Topo para verlo.",

		"revision.subject":    "Cambios en uno de sus sitios",
		"revision.body":       "Cambios guardados en uno de sus sitios desde {time}: {n}. Abra Topo para verlos.",
		"revision.body_named": "Cambios guardados en «{name}» desde {time}: {n}. Abra Topo para verlos.",

		"link-request.subject": "Un navegador nuevo quiere abrir su cuenta de Topo",
		"link-request.body":    "Un navegador pidió abrir su cuenta de Topo. Apruébelo desde un navegador donde ya haya entrado, o use su clave de recuperación. Si no fue usted, ignore este correo y quite ese navegador en su cuenta.",

		"infra.link":     "Siga el enlace de la infraestructura",
		"infra.plain":    "Siga el enlace de la infraestructura: {link}",
		"report.subject": "Se reportó un problema de red",
		"report.phone":   "Teléfono de quien reporta: {phone}",
		"report.pass":    "La contraseña va por separado: se la mandaré por otro medio.",
		"report.footer":  "Este correo lo envió el servidor de Topo en {url} en nombre de {email}. Responda para escribirle.",

		"test.subject": "Correo de prueba de Topo",
		"test.body":    "Esta es una prueba de su servidor de Topo en {url}. El correo funciona.",
	},
	"pt-BR": {
		"footer.notify": "Você recebe estes e-mails por causa da sua conta do Topo. Altere-os em Conta, Notificações.",
		"footer.plain":  "Este e-mail foi enviado pelo servidor do Topo em {url}.",
		"button.open":   "Abrir o Topo",
		"action.open":   "Abrir o Topo:",
		"role.owner":    "proprietário",
		"role.provider": "provedor",
		"role.viewer":   "leitor",

		"signin.subject": "Seu código para entrar no Topo: {code}",
		"signin.body":    "Seu código para entrar no Topo é {code}. Ele vale por {minutes} minutos.",
		"signin.action":  "Ou abra este link no mesmo navegador em que você pediu o código:",
		"signin.button":  "Entrar",
		"signin.after":   "Se você não pediu este código, ignore este e-mail. Ninguém entra sem ele.",

		"invite.subject":       "Você foi convidado para um site no Topo",
		"invite.subject_named": "Você foi convidado para “{name}” no Topo",
		"invite.body":          "{inviter} convidou você para ver uma rede no Topo como {role}. Abra o convite e entre com este endereço para aceitá-lo. O convite vale por 14 dias.",
		"invite.body_named":    "{inviter} convidou você para ver a rede “{name}” no Topo como {role}. Abra o convite e entre com este endereço para aceitá-lo. O convite vale por 14 dias.",
		"invite.action":        "Abrir o convite:",
		"invite.button":        "Abrir o convite",

		"welcome.subject": "Agora você pode usar o Topo",
		"welcome.body":    "{inviter} deu a você acesso ao servidor do Topo em {url}. Entre com este endereço.",

		"member-joined.subject":         "Alguém está esperando acesso",
		"member-joined.body":            "{email} aceitou seu convite para um dos seus sites. Abra o Topo para dar acesso.",
		"member-joined.body_named":      "{email} aceitou seu convite para “{name}”. Abra o Topo para dar acesso.",
		"member-joined.keys.body":       "{email} precisa de acesso de novo a um dos seus sites: as chaves mudaram. Confira o código de segurança antes de dar acesso.",
		"member-joined.keys.body_named": "{email} precisa de acesso de novo a “{name}”: as chaves mudaram. Confira o código de segurança antes de dar acesso.",

		"granted.subject":    "Você já pode abrir seu site no Topo",
		"granted.body":       "Um proprietário deu a você acesso a um site. Abra o Topo para vê-lo.",
		"granted.body_named": "Um proprietário deu a você acesso a “{name}”. Abra o Topo para vê-lo.",

		"incident-sent.subject":    "Um problema foi informado a você",
		"incident-sent.body":       "Um cliente informou um problema em um dos seus sites. Abra o Topo para vê-lo.",
		"incident-sent.body_named": "Um cliente informou um problema em “{name}”. Abra o Topo para vê-lo.",

		"visit-recorded.subject":    "Um provedor registrou uma visita",
		"visit-recorded.body":       "Um provedor registrou uma visita em um dos seus sites. Abra o Topo para vê-la.",
		"visit-recorded.body_named": "Um provedor registrou uma visita em “{name}”. Abra o Topo para vê-la.",
		"visit-recorded.many":       "Visitas registradas em um dos seus sites: {n}. Abra o Topo para vê-las.",
		"visit-recorded.many_named": "Visitas registradas em “{name}”: {n}. Abra o Topo para vê-las.",

		"incident-closed.subject":    "Um problema foi encerrado",
		"incident-closed.body":       "Um problema em um dos seus sites foi marcado como resolvido. Abra o Topo para vê-lo.",
		"incident-closed.body_named": "Um problema em “{name}” foi marcado como resolvido. Abra o Topo para vê-lo.",

		"revision.subject":    "Alterações em um dos seus sites",
		"revision.body":       "Alterações salvas em um dos seus sites desde {time}: {n}. Abra o Topo para vê-las.",
		"revision.body_named": "Alterações salvas em “{name}” desde {time}: {n}. Abra o Topo para vê-las.",

		"link-request.subject": "Um navegador novo quer abrir sua conta do Topo",
		"link-request.body":    "Um navegador pediu para abrir sua conta do Topo. Aprove pelo navegador em que você já entrou ou use sua chave de recuperação. Se não foi você, ignore este e-mail e remova esse navegador na sua conta.",

		"infra.link":     "Siga o link da infraestrutura",
		"infra.plain":    "Siga o link da infraestrutura: {link}",
		"report.subject": "Um problema de rede foi informado",
		"report.phone":   "Telefone de quem informou: {phone}",
		"report.pass":    "A senha vai separada: vou enviá-la por outro meio.",
		"report.footer":  "Este e-mail foi enviado pelo servidor do Topo em {url} em nome de {email}. Responda para escrever a essa pessoa.",

		"test.subject": "E-mail de teste do Topo",
		"test.body":    "Este é um teste do seu servidor do Topo em {url}. O e-mail funciona.",
	},
	"ja": {
		"footer.notify": "Topoのアカウントがあるため、このメールが届いています。変更は「アカウント」の「通知」から行えます。",
		"footer.plain":  "このメールは {url} のTopoサーバーから送信されました。",
		"button.open":   "Topoを開く",
		"action.open":   "Topoを開く:",
		"role.owner":    "オーナー",
		"role.provider": "プロバイダー",
		"role.viewer":   "閲覧者",

		"signin.subject": "Topoのサインインコード: {code}",
		"signin.body":    "Topoにサインインするためのコードは {code} です。有効期間は{minutes}分です。",
		"signin.action":  "または、コードを申請したのと同じブラウザーでこのリンクを開いてください:",
		"signin.button":  "サインイン",
		"signin.after":   "このコードに心当たりがない場合は、このメールを無視してください。コードがなければ誰もサインインできません。",

		"invite.subject":       "Topoのサイトに招待されました",
		"invite.subject_named": "Topoの「{name}」に招待されました",
		"invite.body":          "{inviter} さんが、Topoのネットワークを{role}として見るようあなたを招待しました。招待を開き、このアドレスでサインインして承諾してください。招待の有効期間は14日です。",
		"invite.body_named":    "{inviter} さんが、Topoのネットワーク「{name}」を{role}として見るようあなたを招待しました。招待を開き、このアドレスでサインインして承諾してください。招待の有効期間は14日です。",
		"invite.action":        "招待を開く:",
		"invite.button":        "招待を開く",

		"welcome.subject": "Topoを使えるようになりました",
		"welcome.body":    "{inviter} さんが {url} のTopoサーバーへのアクセスを許可しました。このアドレスでサインインしてください。",

		"member-joined.subject":         "アクセスを待っている人がいます",
		"member-joined.body":            "{email} さんがあなたのサイトの1つへの招待を承諾しました。Topoを開いてアクセスを許可してください。",
		"member-joined.body_named":      "{email} さんが「{name}」への招待を承諾しました。Topoを開いてアクセスを許可してください。",
		"member-joined.keys.body":       "{email} さんがあなたのサイトの1つに再びアクセスする必要があります。鍵が変更されました。アクセスを許可する前に安全コードを確認してください。",
		"member-joined.keys.body_named": "{email} さんが「{name}」に再びアクセスする必要があります。鍵が変更されました。アクセスを許可する前に安全コードを確認してください。",

		"granted.subject":    "Topoでサイトを開けるようになりました",
		"granted.body":       "オーナーがサイトへのアクセスを許可しました。Topoを開いて確認してください。",
		"granted.body_named": "オーナーが「{name}」へのアクセスを許可しました。Topoを開いて確認してください。",

		"incident-sent.subject":    "問題が報告されました",
		"incident-sent.body":       "クライアントがあなたのサイトの1つで問題を報告しました。Topoを開いて確認してください。",
		"incident-sent.body_named": "クライアントが「{name}」で問題を報告しました。Topoを開いて確認してください。",

		"visit-recorded.subject":    "プロバイダーが訪問を記録しました",
		"visit-recorded.body":       "プロバイダーがあなたのサイトの1つで訪問を記録しました。Topoを開いて確認してください。",
		"visit-recorded.body_named": "プロバイダーが「{name}」で訪問を記録しました。Topoを開いて確認してください。",
		"visit-recorded.many":       "あなたのサイトの1つで記録された訪問: {n}件。Topoを開いて確認してください。",
		"visit-recorded.many_named": "「{name}」で記録された訪問: {n}件。Topoを開いて確認してください。",

		"incident-closed.subject":    "問題が解決済みになりました",
		"incident-closed.body":       "あなたのサイトの1つの問題が解決済みになりました。Topoを開いて確認してください。",
		"incident-closed.body_named": "「{name}」の問題が解決済みになりました。Topoを開いて確認してください。",

		"revision.subject":    "あなたのサイトの1つに変更があります",
		"revision.body":       "{time}以降にあなたのサイトの1つで保存された変更: {n}件。Topoを開いて確認してください。",
		"revision.body_named": "{time}以降に「{name}」で保存された変更: {n}件。Topoを開いて確認してください。",

		"link-request.subject": "新しいブラウザーがTopoアカウントを開こうとしています",
		"link-request.body":    "あるブラウザーがあなたのTopoアカウントを開くよう求めています。サインイン済みのブラウザーから承認するか、回復キーを使ってください。心当たりがない場合は、このメールを無視し、アカウントからそのブラウザーを削除してください。",

		"infra.link":     "インフラのリンクを開く",
		"infra.plain":    "インフラのリンクを開く: {link}",
		"report.subject": "ネットワークの問題が報告されました",
		"report.phone":   "報告者の電話番号: {phone}",
		"report.pass":    "パスフレーズは別の方法でお送りします。",
		"report.footer":  "このメールは {email} さんに代わって {url} のTopoサーバーから送信されました。返信するとその方に届きます。",

		"test.subject": "Topoのテストメール",
		"test.body":    "これは {url} のTopoサーバーからのテストです。メールは正常に動作しています。",
	},
	"ru": {
		"footer.notify": "Вы получаете эти письма из-за своей учётной записи Topo. Изменить их можно в разделе «Учётная запись», «Уведомления».",
		"footer.plain":  "Это письмо отправил сервер Topo по адресу {url}.",
		"button.open":   "Открыть Topo",
		"action.open":   "Открыть Topo:",
		"role.owner":    "владелец",
		"role.provider": "поставщик",
		"role.viewer":   "наблюдатель",

		"signin.subject": "Ваш код для входа в Topo: {code}",
		"signin.body":    "Ваш код для входа в Topo: {code}. Он действует {minutes} мин.",
		"signin.action":  "Или откройте эту ссылку в том же браузере, где вы запросили код:",
		"signin.button":  "Войти",
		"signin.after":   "Если вы не запрашивали код, просто проигнорируйте это письмо. Без него никто не сможет войти.",

		"invite.subject":       "Вас приглашают на сайт в Topo",
		"invite.subject_named": "Вас приглашают в «{name}» в Topo",
		"invite.body":          "Пользователь {inviter} приглашает вас просматривать сеть в Topo с ролью «{role}». Откройте приглашение и войдите с этим адресом, чтобы принять его. Приглашение действует 14 дней.",
		"invite.body_named":    "Пользователь {inviter} приглашает вас просматривать сеть «{name}» в Topo с ролью «{role}». Откройте приглашение и войдите с этим адресом, чтобы принять его. Приглашение действует 14 дней.",
		"invite.action":        "Открыть приглашение:",
		"invite.button":        "Открыть приглашение",

		"welcome.subject": "Теперь вы можете пользоваться Topo",
		"welcome.body":    "Пользователь {inviter} открыл вам доступ к серверу Topo по адресу {url}. Войдите с этим адресом.",

		"member-joined.subject":         "Кто-то ждёт доступа",
		"member-joined.body":            "Приглашение на один из ваших сайтов принято: {email}. Откройте Topo, чтобы открыть доступ.",
		"member-joined.body_named":      "Приглашение в «{name}» принято: {email}. Откройте Topo, чтобы открыть доступ.",
		"member-joined.keys.body":       "Пользователю {email} снова нужен доступ к одному из ваших сайтов: ключи пользователя изменились. Проверьте код безопасности, прежде чем открыть доступ.",
		"member-joined.keys.body_named": "Пользователю {email} снова нужен доступ к «{name}»: ключи пользователя изменились. Проверьте код безопасности, прежде чем открыть доступ.",

		"granted.subject":    "Теперь вы можете открыть свой сайт в Topo",
		"granted.body":       "Владелец открыл вам доступ к сайту. Откройте Topo, чтобы увидеть его.",
		"granted.body_named": "Владелец открыл вам доступ к «{name}». Откройте Topo, чтобы увидеть его.",

		"incident-sent.subject":    "Вам сообщили о проблеме",
		"incident-sent.body":       "Клиент сообщил о проблеме на одном из ваших сайтов. Откройте Topo, чтобы увидеть её.",
		"incident-sent.body_named": "Клиент сообщил о проблеме на сайте «{name}». Откройте Topo, чтобы увидеть её.",

		"visit-recorded.subject":    "Поставщик записал визит",
		"visit-recorded.body":       "Поставщик записал визит на одном из ваших сайтов. Откройте Topo, чтобы увидеть его.",
		"visit-recorded.body_named": "Поставщик записал визит на сайте «{name}». Откройте Topo, чтобы увидеть его.",
		"visit-recorded.many":       "Записано визитов на одном из ваших сайтов: {n}. Откройте Topo, чтобы увидеть их.",
		"visit-recorded.many_named": "Записано визитов на сайте «{name}»: {n}. Откройте Topo, чтобы увидеть их.",

		"incident-closed.subject":    "Проблема закрыта",
		"incident-closed.body":       "Проблема на одном из ваших сайтов отмечена как устранённая. Откройте Topo, чтобы увидеть её.",
		"incident-closed.body_named": "Проблема на сайте «{name}» отмечена как устранённая. Откройте Topo, чтобы увидеть её.",

		"revision.subject":    "Изменения на одном из ваших сайтов",
		"revision.body":       "Сохранено изменений на одном из ваших сайтов с {time}: {n}. Откройте Topo, чтобы увидеть их.",
		"revision.body_named": "Сохранено изменений на сайте «{name}» с {time}: {n}. Откройте Topo, чтобы увидеть их.",

		"link-request.subject": "Новый браузер хочет открыть вашу учётную запись Topo",
		"link-request.body":    "Браузер запросил доступ к вашей учётной записи Topo. Подтвердите это в браузере, где вы уже вошли, или используйте ключ восстановления. Если это были не вы, проигнорируйте письмо и удалите этот браузер в своей учётной записи.",

		"infra.link":     "Перейдите по ссылке на инфраструктуру",
		"infra.plain":    "Перейдите по ссылке на инфраструктуру: {link}",
		"report.subject": "Сообщение о проблеме в сети",
		"report.phone":   "Телефон автора сообщения: {phone}",
		"report.pass":    "Пароль придёт отдельно: я пришлю его другим способом.",
		"report.footer":  "Это письмо отправил сервер Topo по адресу {url} от имени {email}. Ответьте, чтобы написать этому человеку.",

		"test.subject": "Тестовое письмо Topo",
		"test.body":    "Это тест вашего сервера Topo по адресу {url}. Почта работает.",
	},
}
