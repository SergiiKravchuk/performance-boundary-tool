# Setting up `config.yaml` for a new pair of endpoints

This guide explains how to replace the current demo endpoints in `demo-app/url-shortener-measurement/config.yaml` with a new pair of endpoints.

Important constraint: `mix.endpoints` must contain exactly 2 endpoints.

## What each field does

- `path`: The request path appended to `target.baseUrl`. It must start with `/`.
- `urlTemplate`: Optional full URL template used instead of `target.baseUrl + path` when it resolves successfully. It can include placeholders and is useful when a later endpoint should call a URL returned by an earlier response.
- `bodyTemplateFile`: Path to a JSON request body template file. It is resolved relative to the folder that contains `config.yaml`. Use `null` for endpoints that do not send a body.
- `bodyGenerators`: Named value generators that can be referenced from JSON body templates as `{{name}}`. Supported types are `uuid`, `random`, and `sequence`.
- `responseCapture`: Values to extract from a JSON response body. The map key is the placeholder name you want to create, and the value is a dot-path selector inside the response JSON.

## Step-by-step

1. Pick the two endpoints you want to measure.

    Because this tool models a fixed two-endpoint traffic mix, decide which 2 endpoints should be in `mix.endpoints` and what weight each one should get.

2. Set each endpoint `path`.

    Use a literal path when the URL is always known, for example:
    
    ```yaml
    path: /api/orders
    ```
    
    Use placeholders when part of the path comes from generated data or from a previous response, for example:
    
    ```yaml
    path: /api/orders/{{orderId}}/status
    ```

    The placeholder name must exist either in `bodyGenerators` or in a previous endpoint's `responseCapture`.

3. Configure `urlTemplate` when an endpoint should call a full URL.

    `urlTemplate` is optional. When present, the tool tries to render it first and uses that full URL instead of combining `target.baseUrl` with `path`.

    This is most useful when endpoint 1 returns a ready-to-call URL and endpoint 2 should follow it directly.

    Example:

    ```yaml
    urlTemplate: '{{shortUrl}}'
    urlTemplateRate: 1.0
    ```

    You can also mix direct-link calls with normal path-based calls by setting `urlTemplateRate` to a value between `0` and `1`:

    ```yaml
    urlTemplate: '{{shortUrl}}'
    urlTemplateRate: 0.70
    ```

    In that setup, about 70% of requests use the rendered `urlTemplate`, and the rest fall back to `path`.

    Rules to follow:

    - Use a full URL or a placeholder that resolves to a full URL.
    - Any placeholder in `urlTemplate` must come from `bodyGenerators` or `responseCapture`.
    - Keep `path` configured even when `urlTemplate` is present, because it is used as the fallback when the template does not resolve or when `urlTemplateRate` sends traffic to the path-based route.

4. Set `bodyTemplateFile` for endpoints that send JSON.

    Create a JSON file next to `config.yaml` or in a subfolder, then point `bodyTemplateFile` to it.
    
    Example:
    
    ```yaml
    bodyTemplateFile: ./create-order-body.json
    ```
    
    Inside the JSON file, placeholders must take the whole string value:
    
    ```json
    {
      "requestId": "{{requestId}}",
      "customerRef": "{{customerRef}}",
      "sku": "{{sku}}"
    }
    ```
    
    If the endpoint does not send a body, set:
    
    ```yaml
    bodyTemplateFile: null
    ```

5. Define `bodyGenerators` for every placeholder used in request bodies.

    Add one generator entry for each placeholder used in any `bodyTemplateFile`.
    
    Example:
    
    ```yaml
    bodyGenerators:
      requestId:
        type: uuid
        duplicateRate: 0.00
        reuseWindow: 100
      customerRef:
        type: random
        length: 10
        charset: alnum
        duplicateRate: 0.01
        reuseWindow: 100
      sku:
        type: sequence
        prefix: sku-
        zeroPad: 5
        duplicateRate: 0.00
        reuseWindow: 100
    ```
    
    Use these generator types:
    
    - `uuid`: Generates UUID values.
    - `random`: Generates random strings. Configure `length` and `charset` (`alpha`, `alnum`, or `hex`).
    - `sequence`: Generates incrementing values. Configure `prefix` and optional `zeroPad`.

6. Add `responseCapture` when the second endpoint needs data from the first response.

    If endpoint 1 returns JSON like this:
    
    ```json
    {
      "id": "ord-123",
      "tracking": {
        "code": "trk-999",
        "url": "http://localhost:8080/api/orders/ord-123/status"
      }
    }
    ```
    
    then you can capture values like this:
    
    ```yaml
    responseCapture:
      orderId: id
      trackingCode: tracking.code
      trackingUrl: tracking.url
    ```
    
    That makes `{{orderId}}`, `{{trackingCode}}`, and `{{trackingUrl}}` available for later request paths or URL templates.

7. Check that placeholder names line up.

    Before running the tool, verify:

    - Every `{{placeholder}}` used in a JSON body exists in `bodyGenerators`.
    - Every `{{placeholder}}` used in `path` exists in `bodyGenerators` or comes from `responseCapture`.
    - Every `{{placeholder}}` used in `urlTemplate` exists in `bodyGenerators` or comes from `responseCapture`.
    - Every `responseCapture` selector points to a field that really exists in the endpoint response JSON.

## Example: two new endpoints

This example measures:

- `POST /api/orders` to create an order
- `GET /api/orders/{{orderId}}/status` to fetch the created order status

### Example `config.yaml` section

```yaml
target:
  baseUrl: http://localhost:8080

mix:
  endpoints:
    - name: createOrder
      weight: 65
      method: POST
      path: /api/orders
      headers:
        Content-Type: application/json
      bodyTemplateFile: ./create-order-body.json
      responseCapture:
        orderId: id
        trackingCode: tracking.code
        trackingUrl: tracking.url

    - name: getOrderStatus
      weight: 35
      method: GET
      path: /api/orders/{{orderId}}/status
      urlTemplate: '{{trackingUrl}}'
      urlTemplateRate: 0.50
      headers:
        Accept: application/json
      bodyTemplateFile: null

bodyGenerators:
  requestId:
    type: uuid
    duplicateRate: 0.00
    reuseWindow: 100
  customerRef:
    type: random
    length: 10
    charset: alnum
    duplicateRate: 0.01
    reuseWindow: 100
  sku:
    type: sequence
    prefix: sku-
    zeroPad: 5
    duplicateRate: 0.00
    reuseWindow: 100
```

### Example `create-order-body.json`

```json
{
  "requestId": "{{requestId}}",
  "customerRef": "{{customerRef}}",
  "sku": "{{sku}}"
}
```

## How the example works

- `createOrder.path` is a fixed path: `/api/orders`.
- `createOrder.bodyTemplateFile` points to a JSON template that uses three generated values.
- `bodyGenerators` produces `requestId`, `customerRef`, and `sku` for the POST body.
- `createOrder.responseCapture.orderId` extracts `id` from the response JSON.
- `createOrder.responseCapture.trackingUrl` extracts a full follow-up URL from the response JSON.
- `getOrderStatus.path` reuses the captured `{{orderId}}` value as the fallback route.
- `getOrderStatus.urlTemplate` can call a full URL returned by the create response when `{{trackingUrl}}` is available.
- `getOrderStatus.bodyTemplateFile` is `null` because the GET request has no body.

## Minimal checklist

- `mix.endpoints` has exactly 2 entries.
- Every `path` starts with `/`.
- Every `urlTemplate` either resolves to a full URL or is omitted.
- Every non-null `bodyTemplateFile` points to valid JSON.
- Every body placeholder has a matching `bodyGenerators` entry.
- Every `responseCapture` selector matches the actual response JSON shape.
