// @flow
import m from "mithril"
import {assertMainOrNode} from "../api/common/Env"
import {Dialog, DialogType} from "../gui/base/Dialog"
import {lang} from "../misc/LanguageViewModel"
import {update} from "../api/main/Entity"
import {DropDownSelector} from "../gui/base/DropDownSelector"
import {EmailSignatureType, FeatureType} from "../api/common/TutanotaConstants"
import {logins} from "../api/main/LoginController"
import {HtmlEditor} from "../gui/editor/HtmlEditor"
import stream from "mithril/stream/stream.js"
import type {TutanotaProperties} from "../api/entities/tutanota/TutanotaProperties"
import {insertInlineImageB64ClickHandler} from "../mail/view/MailViewerUtils"
import {PayloadTooLargeError} from "../api/common/error/RestError"
import {showProgressDialog} from "../gui/ProgressDialog"
import {neverNull} from "../api/common/utils/Utils"

assertMainOrNode()

export function show(props: TutanotaProperties) {
	import("../mail/signature/Signature").then(({getDefaultSignature}) => {
		const defaultSignature = getDefaultSignature()
		let currentCustomSignature = logins.getUserController().props.customEmailSignature
		if (currentCustomSignature === "" && !logins.isEnabled(FeatureType.DisableDefaultSignature)) {
			currentCustomSignature = defaultSignature
		}

		let previousType = logins.getUserController().props.emailSignatureType

		const editor = new HtmlEditor("preview_label", {enabled: true, imageButtonClickHandler: insertInlineImageB64ClickHandler})
			.showBorders()
			.setMinHeight(200)
			.setValue(getSignature(previousType, defaultSignature, currentCustomSignature))

		let typeField = new DropDownSelector("userEmailSignature_label", null, getSignatureTypes(props), stream(previousType))
		typeField.selectedValue.map(type => {
			if (previousType === EmailSignatureType.EMAIL_SIGNATURE_TYPE_CUSTOM) {
				currentCustomSignature = editor.getValue()
			}
			previousType = type
			editor.setValue(getSignature(type, defaultSignature, currentCustomSignature))
			editor.setEnabled(type === EmailSignatureType.EMAIL_SIGNATURE_TYPE_CUSTOM)
		})

		let form = {
			view: () => {
				return [
					m(typeField),
					m(editor),
				]
			}
		}
		let editSignatureOkAction = (dialog) => {
			const props = logins.getUserController().props

			const newType = typeField.selectedValue()
			const newCustomValue = editor.getValue()

			const oldType = props.emailSignatureType
			const oldCustomValue = props.customEmailSignature

			if (newType === oldType && (newType !== EmailSignatureType.EMAIL_SIGNATURE_TYPE_CUSTOM || newCustomValue === oldCustomValue)) {
				return dialog.close()
			} else {
				props.emailSignatureType = newType
				if (newType === EmailSignatureType.EMAIL_SIGNATURE_TYPE_CUSTOM) {
					props.customEmailSignature = newCustomValue
				}
				const updatePromise = update(props)
				return showProgressDialog("pleaseWait_msg", updatePromise)
					.then(() => dialog.close())
					.catch(PayloadTooLargeError, () => {
						props.emailSignatureType = oldType
						props.customEmailSignature = oldCustomValue
						return Dialog.error("requestTooLarge_msg")
					})

			}
		}

		Dialog.showActionDialog({
			title: lang.get("userEmailSignature_label"),
			child: form,
			type: DialogType.EditLarge,
			okAction: editSignatureOkAction
		})
	})
}

export function getSignatureTypes(props: TutanotaProperties): {name: string, value: string}[] {
	let signatureTypes = [
		{name: lang.get("emailSignatureTypeCustom_msg"), value: EmailSignatureType.EMAIL_SIGNATURE_TYPE_CUSTOM},
		{name: lang.get("comboBoxSelectionNone_msg"), value: EmailSignatureType.EMAIL_SIGNATURE_TYPE_NONE},
	]
	if (!logins.isEnabled(FeatureType.DisableDefaultSignature) || props.emailSignatureType
		=== EmailSignatureType.EMAIL_SIGNATURE_TYPE_DEFAULT) {
		signatureTypes.splice(0, 0, {
			name: lang.get("emailSignatureTypeDefault_msg"),
			value: EmailSignatureType.EMAIL_SIGNATURE_TYPE_DEFAULT
		})
	}
	return signatureTypes
}

function getSignature(type: string, defaultSignature: string, currentCustomSignature: string): string {
	if (type === EmailSignatureType.EMAIL_SIGNATURE_TYPE_DEFAULT) {
		return defaultSignature
	} else if (type === EmailSignatureType.EMAIL_SIGNATURE_TYPE_CUSTOM) {
		return currentCustomSignature
	} else {
		return ""
	}
}

export function getSignatureType(props: TutanotaProperties): {name: string, value: string} {
	return neverNull(getSignatureTypes(props).find(t => t.value === props.emailSignatureType))
}