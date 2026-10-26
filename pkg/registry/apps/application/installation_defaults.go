/*
Copyright 2026 The Cozystack Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package application

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	appsv1alpha1 "github.com/cozystack/cozystack/pkg/apis/apps/v1alpha1"
	corev1 "k8s.io/api/core/v1"
	apiextv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func (r *REST) applyInstallationDefaults(ctx context.Context, app *appsv1alpha1.Application) error {
	if r.defaultsReader == nil {
		return nil
	}
	cm := &corev1.ConfigMap{}
	if err := r.defaultsReader.Get(ctx, client.ObjectKey{Namespace: "cozy-system", Name: "cozystack-application-defaults"}, cm); err != nil {
		if apierrors.IsNotFound(err) {
			return nil
		}
		return fmt.Errorf("read application defaults: %w", err)
	}
	defaults, err := parseInstallationDefaults(cm.Data["defaults.json"])
	if err != nil {
		return fmt.Errorf("invalid application defaults: %w", err)
	}
	values := defaults[r.gvr.Resource]
	if len(values) == 0 {
		return nil
	}
	spec := map[string]any{}
	if app.Spec != nil && len(app.Spec.Raw) > 0 {
		if err := decodeDefaultsJSON(app.Spec.Raw, &spec); err != nil {
			return apierrors.NewBadRequest(fmt.Sprintf("decode application spec: %v", err))
		}
	}
	if spec == nil {
		spec = map[string]any{}
	}
	fillInstallationDefaults(spec, values)
	raw, err := json.Marshal(spec)
	if err != nil {
		return err
	}
	app.Spec = &apiextv1.JSON{Raw: raw}
	return nil
}

func parseInstallationDefaults(raw string) (map[string]map[string]any, error) {
	var defaults map[string]map[string]any
	if err := decodeDefaultsJSON([]byte(raw), &defaults); err != nil {
		return nil, err
	}
	if defaults == nil {
		return nil, fmt.Errorf("defaults.json must be an object keyed by application plural")
	}
	for plural, values := range defaults {
		if plural == "" || strings.HasPrefix(plural, "_") || values == nil {
			return nil, fmt.Errorf("%q must name an application plural with an object value", plural)
		}
		for key := range values {
			if strings.HasPrefix(key, "_") {
				return nil, fmt.Errorf("%s: field %q is reserved", plural, key)
			}
		}
	}
	return defaults, nil
}

func decodeDefaultsJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return fmt.Errorf("expected a single JSON object")
	}
	return nil
}

func fillInstallationDefaults(spec, defaults map[string]any) {
	for key, value := range defaults {
		current, present := spec[key]
		if !present {
			spec[key] = clone(value)
			continue
		}
		obj, isObject := current.(map[string]any)
		fallback, isFallbackObject := value.(map[string]any)
		if isObject && len(obj) > 0 && isFallbackObject {
			fillInstallationDefaults(obj, fallback)
		}
	}
}
