import { getDefaultRegistry } from "@rjsf/core"
import { getDefaultFormState, type FieldProps, type RJSFSchema } from "@rjsf/utils"
import validator from "@rjsf/validator-ajv8"
import { isObject } from "../lib/application-defaults.ts"

const ArrayField = getDefaultRegistry().fields.ArrayField

export function CreationArrayField(props: FieldProps) {
  const onChange: FieldProps["onChange"] = (value: unknown, errors, id) => {
    if (props.formContext?.externalDefaults && Array.isArray(value) && isObject(props.schema.items)) {
      const previousLength = Array.isArray(props.formData) ? props.formData.length : 0
      const items = props.schema.items as RJSFSchema
      const populated = value.map((item: unknown, index: number) =>
        index < previousLength ? item : getDefaultFormState(validator, items, item, props.registry.rootSchema),
      )
      props.onChange(populated, errors, id)
    } else {
      props.onChange(value, errors, id)
    }
  }
  return <ArrayField {...props} onChange={onChange} />
}
