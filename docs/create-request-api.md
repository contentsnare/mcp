# Content Snare API: Create Request with Fields

Create a fully structured request in a single API call, with its pages, sections and fields, without needing a pre-built template.

**Endpoint:** `POST /partner_api/v1/requests`

**Authentication:** a personal access token (Settings > Security > Personal Access Tokens) or an OAuth token, sent as `Authorization: Bearer <token>`.

**Required scopes:** `write_requests`, plus `write_clients` if the client doesn't already exist. On the Personal Access Tokens page these are "Manage requests and supported templates" and "Manage clients".

---

## Request body

### Top-level properties

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | The name of the request |
| `client_email` | string | Yes | Client's email address. If the client doesn't exist, one will be created |
| `client_full_name` | string | If new client | Full name for the client (required when creating a new client) |
| `company_name` | string | No | Company name for the client |
| `folder_name` | string | No | Folder to organize the request into |
| `due` | string | No | Due date in `yyyy-mm-dd` format |
| `status` | string | No | `"draft"` (default) or `"published"` |
| `owner_id` | string | No | Team member ID to assign as owner |
| `owner_email` | string | No | Team member email to assign as owner (alternative to `owner_id`) |
| `communication_template_id` | string | No | ID of a communications schedule to attach |
| `communication_template_name` | string | No | Name of a communications schedule (alternative to ID) |
| `comments_enabled` | boolean | No | Allow the client to leave comments |
| `passcode_enabled` | boolean | No | Require a pin code to access |
| `share_via_link_enabled` | boolean | No | Allow the client to share the request via link |
| `pages_data` | array | Yes | Array of page objects (see below) |

---

## Structure: Pages, Sections, and Questions

A request is organized into **pages** (tabs the client sees), each containing one or more **sections**, each containing one or more **questions** (fields).

```
Request
├── Page 1
│   ├── Section A
│   │   ├── Question 1
│   │   ├── Question 2
│   │   └── Question 3
│   └── Section B
│       └── Question 4
└── Page 2
    └── Section C
        ├── Question 5
        └── Question 6
```

### Page object

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Page name (displayed as a tab) |
| `sections_data` | array | Yes | Array of section objects |

### Section object

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Section heading |
| `questions_data` | array | Yes | Array of question objects |

### Question object

| Property | Type | Required | Description |
|---|---|---|---|
| `question` | string | Yes | The question or field label displayed to the client |
| `data_type` | string | Yes | The field type (see full list below) |
| `question_number` | integer | Yes | Sequential number starting from 1, unique across the entire request |
| `options` | array of strings | Conditional | Required for: `single select option`, `multi select options`, `dropdown`, `task list` |
| `columns` | array of strings | Conditional | Required for: `table` |
| `instructions` | string | No | Help text shown to the client explaining how to complete the field |
| `show_when` | object | No | Conditional visibility rules (see below) |

---

## Field types (`data_type`)

### Text input

| Value | Description |
|---|---|
| `single-line` | Single-line text input |
| `text` | Standard text input |
| `multi-line text` | Multi-line textarea |
| `formatted text` | Rich text editor |

### Contact information

| Value | Description |
|---|---|
| `email` | Email address with validation |
| `phone` | Phone number input |
| `url` | URL with validation |
| `address` | Structured address fields |
| `country select` | Country dropdown |

### File uploads

| Value | Description |
|---|---|
| `single image upload` | Upload one image |
| `multiple image upload` | Upload multiple images |
| `single file upload` | Upload one file |
| `multiple file upload` | Upload multiple files |

### Numbers and dates

| Value | Description |
|---|---|
| `number` | Numeric input |
| `currency` | Currency/monetary value |
| `date/time` | Date and time picker |
| `date range` | Start and end date selection |

### Ratings

| Value | Description |
|---|---|
| `numeric rating` | Numeric scale rating |
| `star rating` | Star-based rating |

### Selection fields

These types require the `options` array.

| Value | Description |
|---|---|
| `single select option` | Radio-button-style single selection |
| `multi select options` | Checkbox-style multiple selection |
| `dropdown` | Dropdown single selection |
| `task list` | Checklist of items |

### Data entry

This type requires the `columns` array.

| Value | Description |
|---|---|
| `table` | Table with defined column headers; client adds rows |

### Other

| Value | Description |
|---|---|
| `signature` | Signature capture |
| `button` | Clickable button |
| `icon` | Icon field |
| `color picker` | Color selection |

---

## Conditional visibility (`show_when`)

Questions can be shown or hidden based on the client's answers to other questions. This lets you build dynamic, branching forms.

### Structure

```json
{
  "show_when": {
    "conditions": [
      {
        "question_number": 1,
        "condition": "equals",
        "value": "Yes"
      }
    ],
    "logical_operator": "and"
  }
}
```

| Property | Type | Required | Description |
|---|---|---|---|
| `conditions` | array | Yes | One or more condition objects |
| `logical_operator` | string | Yes, even with one condition | `"and"` (all must match) or `"or"` (any must match). Leave it out and the request fails with `logical_operator is missing` |

To hide a question when conditions match instead, use `hide_when` with the same structure. Use `show_when` or `hide_when` on a question, not both.

### Condition object

| Property | Type | Required | Description |
|---|---|---|---|
| `question_number` | integer | Yes | The `question_number` of the field to evaluate. It must be on the same page |
| `condition` | string | Yes | The comparison operator (see below) |
| `value` | string | Yes | The value to compare against. For `is empty` and `has a value`, send an empty string `""` |

### Rules that fail silently

Content Snare accepts these but drops the condition, so the question always shows:

- **A condition that points at a question on another page.** Conditional logic is built one page at a time. Keep a conditional question on the same page as every question it depends on.
- **A choice value that doesn't match an option exactly.** For `single select option`, `multi select options`, `dropdown` and `task list` questions, an `equals` or `does not equal` value must be the exact text of one of that question's options. Matching is case-sensitive, so `"yes"` won't match an option called `"Yes"`.
- **A condition with no `value`.** Send `""` rather than leaving it out.

### Available conditions

| Condition | Description |
|---|---|
| `contains` | Field value contains the specified text |
| `equals` | Field value exactly matches |
| `does not equal` | Field value does not match |
| `less than` | Numeric comparison |
| `greater than` | Numeric comparison |
| `is empty` | Field has no value |
| `has a value` | Field has any value |

---

## Full example

This example creates a vendor onboarding form with two pages, conditional logic, and a variety of field types.

```json
{
  "name": "Vendor Application Form",
  "client_email": "vendor@example.com",
  "client_full_name": "Jane Smith",
  "company_name": "Smith Supplies",
  "due": "2026-04-15",
  "status": "published",
  "pages_data": [
    {
      "name": "Company Information",
      "sections_data": [
        {
          "name": "Basic Details",
          "questions_data": [
            {
              "question": "Legal business name",
              "data_type": "single-line",
              "question_number": 1
            },
            {
              "question": "Business type",
              "data_type": "dropdown",
              "question_number": 2,
              "options": [
                "Sole Proprietor",
                "Partnership",
                "Corporation",
                "LLC",
                "Other"
              ]
            },
            {
              "question": "If Other, please specify",
              "data_type": "single-line",
              "question_number": 3,
              "show_when": {
                "conditions": [
                  {
                    "question_number": 2,
                    "condition": "equals",
                    "value": "Other"
                  }
                ],
                "logical_operator": "and"
              }
            },
            {
              "question": "Business address",
              "data_type": "address",
              "question_number": 4
            },
            {
              "question": "Company website",
              "data_type": "url",
              "question_number": 5
            },
            {
              "question": "Contact phone",
              "data_type": "phone",
              "question_number": 6
            }
          ]
        },
        {
          "name": "Company Profile",
          "questions_data": [
            {
              "question": "Company logo",
              "data_type": "single image upload",
              "question_number": 7,
              "instructions": "Please upload a high-resolution PNG or SVG file"
            },
            {
              "question": "Describe your products or services",
              "data_type": "multi-line text",
              "question_number": 8
            },
            {
              "question": "How would you rate your production capacity?",
              "data_type": "star rating",
              "question_number": 9
            }
          ]
        }
      ]
    },
    {
      "name": "Compliance & Documents",
      "sections_data": [
        {
          "name": "Certifications",
          "questions_data": [
            {
              "question": "Do you hold any industry certifications?",
              "data_type": "single select option",
              "question_number": 10,
              "options": ["Yes", "No"]
            },
            {
              "question": "Upload certification documents",
              "data_type": "multiple file upload",
              "question_number": 11,
              "instructions": "PDF or scanned copies accepted",
              "show_when": {
                "conditions": [
                  {
                    "question_number": 10,
                    "condition": "equals",
                    "value": "Yes"
                  }
                ],
                "logical_operator": "and"
              }
            },
            {
              "question": "List certifications and expiry dates",
              "data_type": "table",
              "question_number": 12,
              "columns": [
                "Certification Name",
                "Issuing Body",
                "Expiry Date"
              ],
              "show_when": {
                "conditions": [
                  {
                    "question_number": 10,
                    "condition": "equals",
                    "value": "Yes"
                  }
                ],
                "logical_operator": "and"
              }
            }
          ]
        },
        {
          "name": "Agreement",
          "questions_data": [
            {
              "question": "Compliance checklist",
              "data_type": "task list",
              "question_number": 13,
              "options": [
                "I agree to the Terms of Service",
                "I have read the Privacy Policy",
                "I confirm all information is accurate"
              ]
            },
            {
              "question": "Authorized signature",
              "data_type": "signature",
              "question_number": 14
            },
            {
              "question": "Date signed",
              "data_type": "date/time",
              "question_number": 15
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Notes

- **`question_number` must be unique** across the entire request (not just within a section). Start at 1 and increment sequentially.
- **Conditions only work within a page.** A condition refers to another question by `question_number`, and that question must be on the same page. A condition pointing at a question on another page is ignored and the field always shows.
- **New clients are created automatically** if no client with the given `client_email` exists. In that case, `client_full_name` is required.
- **Draft vs. published:** Requests created as `"draft"` are not visible to the client until you change the status to `"published"`.
- **Rate limits:** The API allows 20 write operations per 10 seconds.
