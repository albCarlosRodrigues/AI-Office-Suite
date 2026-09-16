import fs from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parsePrxReplyV2,
  parsePrxReplyCandidate,
  parsePrxTransportCandidate,
} from "../cdp-session.server";

describe(
  "live PRX failure diagnostic",
  () => {
    it(
      "diagnoses the exact rendered response",
      () => {
        const path =
          process.env[
            "PRX_FAILURE_CASE"
          ];

        expect(
          path
        ).toBeTruthy();

        const data =
          JSON.parse(
            fs.readFileSync(
              path!,
              "utf8"
            )
          ) as {
            requestId: string;
            raw: string;
          };

        const expected = {
          requestId:
            data.requestId,

          sessionId:
            "prx-geral-confirmacao",

          conversationId:
            "https://chatgpt.com/g/g-p-6aa868af0cd0819188e1d6d1fda02e29/c/6aa868d5-27a4-83e9-aebe-006d9b6738e3",

          agentId:
            "2c10fb31-1718-484f-a2f1-d6da2195ed74",
        };

        console.log("");
        console.log(
          "RAW LENGTH:",
          data.raw.length
        );

        console.log(
          "REQUEST ID:",
          data.requestId
        );

        const v2 =
          parsePrxReplyV2(
            data.raw,
            expected
          );

        console.log(
          "V2:",
          v2
            ? "ACCEPTED"
            : "REJECTED"
        );

        const v1 =
          parsePrxReplyCandidate(
            data.raw,
            expected
          );

        console.log(
          "V1:",
          v1
            ? "ACCEPTED"
            : "REJECTED"
        );

        const combined =
          parsePrxTransportCandidate(
            data.raw,
            expected
          );

        console.log(
          "COMBINED:",
          combined
            ? "ACCEPTED"
            : "REJECTED"
        );

        if (combined) {
          console.log(
            "RESULT LENGTH:",
            String(
              combined.text
            ).length
          );

          console.log(
            "RESULT PREFIX:",
            String(
              combined.text
            ).slice(
              0,
              700
            )
          );
        }

        /*
         * Não queremos mascarar a falha.
         * Esse expect deve falhar se o runtime
         * realmente não consegue interpretar
         * a resposta capturada.
         */
        expect(
          combined
        ).not.toBeNull();
      }
    );
  }
);