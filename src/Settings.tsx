import { storage } from "@vendetta/plugin";
import { findByProps } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

const { FormSwitchRow, FormInput, FormRow, FormSection, FormDivider } = Forms;
const { View } = ReactNative;
const UserStore = findByProps("getUser", "getCurrentUser");

export default function Settings() {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
  const [input, setInput] = React.useState("");

  const addException = () => {
    const id = input.trim();
    if (!id) return;
    if (!/^\d+$/.test(id)) {
      showToast("Enter a valid user ID");
      return;
    }
    if (storage.bannerExceptions.includes(id)) {
      showToast("Already in the list");
      return;
    }
    storage.bannerExceptions.push(id);
    setInput("");
    forceUpdate();
  };

  const removeException = (id) => {
    storage.bannerExceptions = storage.bannerExceptions.filter((x) => x !== id);
    forceUpdate();
  };

  return (
    <View>
      <FormSection title="General">
        <FormSwitchRow
          label="Remove banners"
          subLabel="Strips banners from users everywhere"
          value={storage.removeBanner}
          onValueChange={(v) => {
            storage.removeBanner = v;
            forceUpdate();
          }}
        />
      </FormSection>

      <FormSection title="Exceptions">
        <FormInput
          title="User ID"
          placeholder="Add a user ID to keep their banner"
          value={input}
          onChange={setInput}
          onSubmitEditing={addException}
          returnKeyType="done"
        />
        <FormDivider />
        {storage.bannerExceptions.length === 0 && (
          <FormRow label="No exceptions added" />
        )}
        {storage.bannerExceptions.map((id) => {
          const user = UserStore?.getUser?.(id);
          return (
            <FormRow
              key={id}
              label={user?.username ?? id}
              subLabel={id}
              trailing={FormRow.Icon ? (
                <FormRow.Icon source={findByProps("getAssetIDByName")?.getAssetIDByName?.("ic_close")} />
              ) : undefined}
              onPress={() => removeException(id)}
            />
          );
        })}
      </FormSection>
    </View>
  );
}
