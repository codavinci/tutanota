// @flow
import {stringToBase64, stringToUtf8Uint8Array, uint8ArrayToBase64} from "../../api/common/utils/Encoding"
import {pad} from "../../api/common/utils/StringUtils"
import {createDataFile, getCleanedMimeType} from "../../api/common/DataFile"
import {assertNotNull} from "../../api/common/utils/Utils"
import {formatSortableDateTime, sortableTimestamp} from "../../api/common/utils/DateUtils"
import type {MailBundle} from "./Bundler"
import {isDesktop} from "../../api/common/Env"
import {nativeApp} from "../../native/common/NativeWrapper"
import {fileApp} from "../../native/common/FileApp"
import {Request} from "../../api/common/WorkerProtocol"
import {promiseMap} from "../../api/common/utils/PromiseUtils"

// .msg export is handled in DesktopFileExport because it uses APIs that can't be loaded web side
export type MailExportMode = "msg" | "eml"

export function generateMailFile(bundle: MailBundle, mode: MailExportMode): Promise<DataFile> {
	return mode === "eml"
		? Promise.resolve(mailToEmlFile(bundle))
		: Promise.resolve(fileApp.mailToMsg(bundle))
}

export function getMailExportMode(): Promise<MailExportMode> {
	return isDesktop()
		? nativeApp.invokeNative(new Request("sendDesktopConfig", []))
		           .then(config => config.mailExportMode)
		: Promise.resolve("eml")
}

export function generateExportFileName(mail: MailBundle, mode: MailExportMode): string {
	let filename = [...formatSortableDateTime(new Date(mail.sentOn)).split(' '), mail.subject].join('-')
	filename = filename.trim()
	if (filename.length === 0) {
		filename = "unnamed"
	} else if (filename.length > 96) {
		// windows MAX_PATH is 260, this should be fairly safe.
		filename = filename.substring(0, 95) + '_'
	}
	return `${filename}.${mode}`
}

/**
 * export a set of mails into a zip file and offer to download
 * @returns {Promise<void>} resolved after the fileController
 * was instructed to open the new zip File containing the mail eml
 * @param bundles
 */
export function exportMailsInZip(bundles: Array<MailBundle>): Promise<void> {

	return Promise.all([
		getMailExportMode(), import("../../file/FileController")
	]).then(([mode, fileControllerModule]) => {
		const fileController = fileControllerModule.fileController
		const zipName = `${sortableTimestamp()}-${mode}-mail-export.zip`
		promiseMap(bundles, bundle => generateMailFile(bundle, mode))
			.then(files => fileController.zipDataFiles(files, zipName)
			                             .then(zip => fileController.open(zip)))
	})
}

export function mailToEmlFile(mail: MailBundle): DataFile {
	const data = stringToUtf8Uint8Array(mailToEml(mail))
	const filename = generateExportFileName(mail, "eml")
	return createDataFile(filename, "message/rfc822", data)
}

/**
 * Converts a mail into the plain text EML format.
 */
export function mailToEml(mail: MailBundle): string {


	const lines = []

	if (mail.headers) {
		const filteredHeaders = mail.headers
		                            .split("\n")
		                            .filter(line => !line.match(/^\s*(Content-Type:|boundary=)/))
		                            .filter(line => line !== "")
		lines.push(...filteredHeaders)
	} else {
		lines.push(
			"From: " + mail.sender.address,
			"MIME-Version: 1.0"
		)
		const formatRecipients = (key, recipients) =>
			`${key}: ${recipients.map(recipient => (recipient.name ? `<${recipient.name}> ` : "") + recipient.address).join(",")}`
		if (mail.to.length > 0) {
			lines.push(formatRecipients("To", mail.to))
		}
		if (mail.cc.length > 0) {
			lines.push(formatRecipients("CC", mail.cc))
		}
		if (mail.bcc.length > 0) {
			lines.push(formatRecipients("BCC", mail.bcc))
		}
		let subject = (mail.subject.trim() === "")
			? ""
			: `=?UTF-8?B?${uint8ArrayToBase64(stringToUtf8Uint8Array(mail.subject))}?=`
		lines.push(
			"Subject: " + subject,
			"Date: " + _formatSmtpDateTime(new Date(mail.sentOn)),
			// TODO (later) load conversation entries and write message id and references
			//"Message-ID: " + // <006e01cf442b$52864f10$f792ed30$@tutao.de>
			//References: <53074EB8.4010505@tutao.de> <DD374AF0-AC6D-4C58-8F38-7F6D8A0307F3@tutao.de> <530E3529.70503@tutao.de>
		)

	}
	lines.push(
		"Content-Type: multipart/related; boundary=\"------------79Bu5A16qPEYcVIZL@tutanota\"",
		"",
		"--------------79Bu5A16qPEYcVIZL@tutanota",
		"Content-Type: text/html; charset=UTF-8",
		"Content-transfer-encoding: base64",
		""
	)
	for (let bodyLine of breakIntoLines(stringToBase64(mail.body))) {
		lines.push(bodyLine)
	}
	lines.push("")
	for (let attachment of mail.attachments) {
		const base64Filename = `=?UTF-8?B?${uint8ArrayToBase64(stringToUtf8Uint8Array(attachment.name))}?=`
		const fileContentLines = breakIntoLines(uint8ArrayToBase64(attachment.data))
		lines.push(
			"--------------79Bu5A16qPEYcVIZL@tutanota",
			"Content-Type: " + getCleanedMimeType(attachment.mimeType) + ";",
			" name=" + base64Filename + "",
			"Content-Transfer-Encoding: base64",
			"Content-Disposition: attachment;",
			" filename=" + base64Filename + ""
		)
		if (attachment.cid) {
			lines.push("Content-Id: <" + attachment.cid + ">")
		}
		lines.push("")
		// don't use destructuring, big files can hit callstack limit
		for (let fileLine of fileContentLines) {
			lines.push(fileLine)
		}
		lines.push("")
	}
	lines.push("--------------79Bu5A16qPEYcVIZL@tutanota--")
	return lines.join("\r\n")
}


export function _formatSmtpDateTime(date: Date): string {
	const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
	const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
	return dayNames[date.getUTCDay()] + ", " + date.getUTCDate() + " " + monthNames[date.getUTCMonth()] + " "
		+ date.getUTCFullYear() + " " + pad(date.getUTCHours(), 2) + ":" + pad(date.getUTCMinutes(), 2) + ":"
		+ pad(date.getUTCSeconds(), 2) + " +0000"
}

/**
 * Break up a long string into lines of up to 78 characters
 * @param string
 * @returns the lines, each as an individual array
 */
function breakIntoLines(string: string): Array<string> {
	return string.length > 0
		? assertNotNull(string.match(/.{1,78}/g))
		: []
}